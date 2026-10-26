/** Experimental v1. Pure, deterministic implementation; legacy workers are untouched. */
const EMPTY = 0xFFFF
const linear = v => {
  v /= 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const srgb = v => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

// Oklab from linear sRGB (D65), public-domain matrices by Björn Ottosson:
// https://bottosson.github.io/posts/oklab/ (2021-01-25 revision).
export function toOklab(rgb) {
  const [r, g, b] = rgb.map(linear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
const distance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

/** @param {import('../types/index.ts').WorkerRequest} msg */
export function convertPerceptual(msg, progress = (_value) => {}) {
  const { imageWidth: sw, imageHeight: sh, params, palette } = msg
  const { width: w, height: h, mode = 'dominant', dithering = false } = params
  if (![sw, sh, w, h].every(v => Number.isInteger(v) && v > 0) ||
      w > 200 || h > 200 || sw * sh > 16000000 ||
      msg.imageData.byteLength !== sw * sh * 4) throw new Error('图像或网格尺寸无效')
  if (!palette.length || palette.length >= EMPTY) throw new Error('色板为空或过大')
  const src = new Uint8ClampedArray(msg.imageData)
  const labs = palette.map(c => toOklab(c.rgb))
  const nearest = lab => {
    let best = 0, error = Infinity
    for (let j = 0; j < labs.length; j++) {
      const d = distance(lab, labs[j])
      if (d < error) { error = d; best = j }
    }
    return best
  }
  const cache = new Map()
  const sourceIndex = p => {
    const key = (src[p] << 16) | (src[p + 1] << 8) | src[p + 2]
    if (!cache.has(key)) cache.set(key, nearest(toOklab([src[p], src[p + 1], src[p + 2]])))
    return cache.get(key)
  }
  const grid = new Uint16Array(w * h).fill(EMPTY)
  const samples = new Array(w * h)
  const targets = new Array(w * h)
  const initialError = new Float64Array(w * h)
  const sxScale = sw / w, syScale = sh / h
  progress(5)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = x * sxScale, x1 = (x + 1) * sxScale
      const y0 = y * syScale, y1 = (y + 1) * syScale
      let coverage = 0
      const sums = [0, 0, 0]
      const votes = new Map()
      for (let sy = Math.floor(y0); sy < Math.min(sh, Math.ceil(y1)); sy++) {
        for (let sx = Math.floor(x0); sx < Math.min(sw, Math.ceil(x1)); sx++) {
          const p = (sy * sw + sx) * 4
          const area = (Math.min(sx + 1, x1) - Math.max(sx, x0)) *
            (Math.min(sy + 1, y1) - Math.max(sy, y0))
          const weight = area * src[p + 3] / 255
          if (weight <= 0) continue
          coverage += weight
          for (let c = 0; c < 3; c++) sums[c] += linear(src[p + c]) * weight
          if (mode === 'dominant') {
            const index = sourceIndex(p)
            const vote = votes.get(index) ?? { weight: 0, sum: [0, 0, 0] }
            vote.weight += weight
            for (let c = 0; c < 3; c++) vote.sum[c] += linear(src[p + c]) * weight
            votes.set(index, vote)
          }
        }
      }
      const i = y * w + x
      if (coverage < sxScale * syScale * 0.5 || coverage === 0) continue
      let rgb = sums.map(v => srgb(v / coverage))
      if (mode === 'dominant') {
        let winner, winnerIndex = 0
        for (const [index, vote] of votes) {
          if (!winner || vote.weight > winner.weight) { winner = vote; winnerIndex = index }
        }
        // Preserve a substantial, high-contrast dark contour even when it falls
        // across cell boundaries. Restrict this to cartoon mode and edgeEnhance.
        if (params.edgeEnhance) {
          const dominantLightness = labs[winnerIndex][0]
          let contourWeight = 0
          for (const [index, vote] of votes) {
            if (vote.weight >= coverage * 0.35 && vote.weight > contourWeight &&
                labs[index][0] < 0.45 && dominantLightness - labs[index][0] > 0.22) {
              winner = vote
              contourWeight = vote.weight
            }
          }
        }
        rgb = winner.sum.map(v => srgb(v / winner.weight))
      }
      samples[i] = rgb
      targets[i] = toOklab(rgb)
      grid[i] = nearest(targets[i])
      initialError[i] = distance(targets[i], labs[grid[i]])
    }
    if (y % 8 === 0) progress(5 + Math.round(60 * (y + 1) / h))
  }

  // Merge near palette colors only within a bounded increase in source error.
  // This is a different scale from the legacy RGB threshold, intentionally documented.
  const strength = Math.min(100, Math.max(0, params.mergeThreshold ?? 30))
  const radius = strength * 0.0012
  const budget = (strength * 0.00065) ** 2
  const groups = new Map()
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === EMPTY) continue
    const list = groups.get(grid[i]) ?? []
    list.push(i)
    groups.set(grid[i], list)
  }
  const ordered = [...groups.keys()].sort((a, b) => groups.get(b).length - groups.get(a).length || a - b)
  const active = new Set(ordered)
  for (const keep of ordered) {
    if (!active.has(keep)) continue
    for (const drop of ordered) {
      if (drop === keep || !active.has(drop) || groups.get(drop).length > groups.get(keep).length ||
          distance(labs[keep], labs[drop]) >= radius ** 2) continue
      const cells = groups.get(drop)
      let increase = 0, worst = 0
      for (const i of cells) {
        const delta = distance(targets[i], labs[keep]) - initialError[i]
        increase += delta
        worst = Math.max(worst, delta)
      }
      if (increase / cells.length > budget || worst > budget * 2) continue
      for (const i of cells) grid[i] = keep
      groups.get(keep).push(...cells)
      active.delete(drop)
    }
  }
  progress(80)

  // Serpentine diffusion. Transparent cells neither receive nor transmit error.
  if (dithering && active.size) {
    const errors = new Float32Array(w * h * 3)
    for (let y = 0; y < h; y++) {
      const direction = y % 2 ? -1 : 1
      for (let step = 0; step < w; step++) {
        const x = direction === 1 ? step : w - 1 - step
        const i = y * w + x
        if (grid[i] === EMPTY) continue
        const rgb = samples[i].map((v, c) => Math.min(255, Math.max(0, v + errors[i * 3 + c])))
        const lab = toOklab(rgb)
        let best = grid[i], min = Infinity
        for (const j of active) {
          const d = distance(lab, labs[j])
          if (d < min) { min = d; best = j }
        }
        grid[i] = best
        for (const [dx, dy, weight] of [[direction, 0, 7 / 16], [-direction, 1, 3 / 16], [0, 1, 5 / 16], [direction, 1, 1 / 16]]) {
          const nx = x + dx, ny = y + dy, ni = ny * w + nx
          if (nx < 0 || nx >= w || ny >= h || grid[ni] === EMPTY) continue
          for (let c = 0; c < 3; c++) errors[ni * 3 + c] += (rgb[c] - palette[best].rgb[c]) * weight
        }
      }
    }
  }
  const paletteUsed = [], indices = new Map()
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === EMPTY) continue
    const index = grid[i]
    if (!indices.has(index)) { indices.set(index, paletteUsed.length); paletteUsed.push(palette[index].id) }
    grid[i] = indices.get(index)
  }
  progress(100)
  return { grid, paletteUsed }
}
