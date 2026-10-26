/** Opt-in cartoon pipeline. The two existing conversion algorithms are frozen. */
import { convertPerceptual, toOklab } from './perceptualCore.js'

const EMPTY = 0xFFFF
const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** Find the largest foreground component against a near-uniform border.
 * This is geometry, not semantic recognition: the user must opt in and review.
 */
export function findSubjectBounds(src, w, h) {
  const border = [[], [], []]
  for (let i = 0; i < 64; i++) {
    const x = Math.floor(i * (w - 1) / 63), y = Math.floor(i * (h - 1) / 63)
    for (const p of [x * 4, ((h - 1) * w + x) * 4, y * w * 4, (y * w + w - 1) * 4]) {
      if (src[p + 3] < 128) continue
      for (let c = 0; c < 3; c++) border[c].push(src[p + c])
    }
  }
  const transparentBorder = border[0].length < 128
  const bg = border.map(values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 255)
  if (!transparentBorder) {
    const uniform = border[0].filter((_, i) => border.every((values, c) => Math.abs(values[i] - bg[c]) < 24)).length
    if (uniform < border[0].length * 0.75) return null
  }
  const scale = Math.min(1, 192 / Math.max(w, h))
  const sw = Math.max(1, Math.round(w * scale)), sh = Math.max(1, Math.round(h * scale))
  const mask = new Uint8Array(sw * sh)
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const p = (Math.min(h - 1, Math.floor((y + .5) * h / sh)) * w + Math.min(w - 1, Math.floor((x + .5) * w / sw))) * 4
    const distance = (src[p] - bg[0]) ** 2 + (src[p + 1] - bg[1]) ** 2 + (src[p + 2] - bg[2]) ** 2
    if (src[p + 3] >= 128 && (transparentBorder || distance > 28 ** 2)) mask[y * sw + x] = 1
  }
  // One-pixel dilation connects anti-aliased contour gaps at the analysis scale.
  const connected = mask.slice()
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (mask[y * sw + x]) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (x + dx >= 0 && x + dx < sw && y + dy >= 0 && y + dy < sh) connected[(y + dy) * sw + x + dx] = 1
    }
  }
  const queue = new Int32Array(mask.length)
  const components = []
  for (let i = 0; i < connected.length; i++) {
    if (!connected[i]) continue
    let head = 0, tail = 1, count = 0, left = sw, right = 0, top = sh, bottom = 0
    queue[0] = i; connected[i] = 0
    while (head < tail) {
      const p = queue[head++], x = p % sw, y = Math.floor(p / sw)
      if (mask[p]) { count++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y) }
      for (const n of [x ? p - 1 : -1, x < sw - 1 ? p + 1 : -1, y ? p - sw : -1, y < sh - 1 ? p + sw : -1]) {
        if (n >= 0 && connected[n]) { connected[n] = 0; queue[tail++] = n }
      }
    }
    if (count >= mask.length * .015) components.push({ count, left, right, top, bottom, area: (right - left + 1) * (bottom - top + 1) })
  }
  // A pale character's interior may resemble the background. Rank by spatial
  // extent, not ink area, or a solid text panel can outweigh a larger line drawing.
  components.sort((a, b) => b.area - a.area)
  const best = components[0]
  if (!best || best.count < mask.length * .02 || (components[1]?.area ?? 0) > best.area * .7) return null
  const pad = Math.max(2, Math.round(Math.max(best.right - best.left, best.bottom - best.top) * .045))
  const x = Math.max(0, Math.floor((best.left - pad) * w / sw))
  const y = Math.max(0, Math.floor((best.top - pad) * h / sh))
  const right = Math.min(w, Math.ceil((best.right + pad + 1) * w / sw))
  const bottom = Math.min(h, Math.ceil((best.bottom + pad + 1) * h / sh))
  if ((right - x) * (bottom - y) > w * h * .92) return null
  return { x, y, w: right - x, h: bottom - y }
}

export function frameSubject(msg) {
  const src = new Uint8ClampedArray(msg.imageData), w = msg.imageWidth, h = msg.imageHeight
  const bounds = findSubjectBounds(src, w, h)
  if (!bounds) return msg
  // Fit, never stretch. Letterbox pixels remain transparent. Source colors stay intact.
  const dst = new Uint8ClampedArray(src.length)
  const zoom = Math.min(w / bounds.w, h / bounds.h)
  const dx = (w - bounds.w * zoom) / 2, dy = (h - bounds.h * zoom) / 2
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = (x + .5 - dx) / zoom, sy = (y + .5 - dy) / zoom
    if (sx < 0 || sy < 0 || sx >= bounds.w || sy >= bounds.h) continue
    const p = ((bounds.y + Math.floor(sy)) * w + bounds.x + Math.floor(sx)) * 4
    dst.set(src.subarray(p, p + 4), (y * w + x) * 4)
  }
  return { ...msg, imageData: dst.buffer }
}

export function convertCartoon(input, progress = () => {}) {
  // Validate using the existing pure implementation before accessing pixels.
  const valid = [input.imageWidth, input.imageHeight, input.params.width, input.params.height]
  if (!valid.every(n => Number.isInteger(n) && n > 0) || input.params.width > 200 || input.params.height > 200 ||
    input.imageWidth * input.imageHeight > 16000000 || input.imageData.byteLength !== input.imageWidth * input.imageHeight * 4 || !input.palette.length) {
    throw new Error('图像或网格尺寸无效')
  }
  const msg = input.params.subjectFocus ? frameSubject(input) : input
  const result = convertPerceptual({ ...msg, params: { ...msg.params, edgeEnhance: false } }, p => progress(Math.round(p * .7)))
  if (msg.params.mode === 'average' || msg.params.edgeEnhance === false) { progress(100); return result }
  const { imageWidth: sw, imageHeight: sh, params: { width: w, height: h }, palette } = msg
  const src = new Uint8ClampedArray(msg.imageData)
  const coverage = new Float32Array(w * h), darkColors = new Array(w * h)
  const labs = palette.map(c => toOklab(c.rgb))
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = x * sw / w, x1 = (x + 1) * sw / w, y0 = y * sh / h, y1 = (y + 1) * sh / h
    let total = 0, dark = 0
    const sum = [0, 0, 0]
    for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
      const p = (sy * sw + sx) * 4
      const weight = (Math.min(sx + 1, x1) - Math.max(sx, x0)) * (Math.min(sy + 1, y1) - Math.max(sy, y0)) * src[p + 3] / 255
      total += weight
      // Pool dark shades BEFORE voting: JPEG/antialias variants must not split
      // one contour into many losing color buckets.
      if (luminance(src[p], src[p + 1], src[p + 2]) < 115) {
        dark += weight
        for (let c = 0; c < 3; c++) sum[c] += src[p + c] * weight
      }
    }
    const i = y * w + x
    if (total < (x1 - x0) * (y1 - y0) * .5 || !dark) continue
    coverage[i] = dark / total
    darkColors[i] = sum.map(v => v / dark)
  }
  const byId = new Map(palette.map(c => [c.id, c]))
  const darkCandidates = palette.map((c, i) => ({ c, i }))
    .filter(({ c }) => result.paletteUsed.includes(c.id) && luminance(...c.rgb) < 115).map(({ i }) => i)
  for (let i = 0; i < result.grid.length; i++) {
    if (result.grid[i] === EMPTY || coverage[i] < .12) continue
    const x = i % w, y = Math.floor(i / w)
    let neighbors = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || x + dx < 0 || y + dy < 0 || x + dx >= w || y + dy >= h) continue
      if (coverage[(y + dy) * w + x + dx] >= .22) neighbors++
    }
    // Weak cells are kept only beside supported strokes; never invent bridges
    // where the source has no dark pixels. Strong isolated eyes are retained.
    if (coverage[i] < .22 && neighbors < 2) continue
    const current = byId.get(result.paletteUsed[result.grid[i]])
    if (luminance(...current.rgb) < 115) continue
    const lab = toOklab(darkColors[i])
    let best = 0, error = Infinity
    for (const j of darkCandidates.length ? darkCandidates : palette.map((_, j) => j)) {
      const d = labs[j].reduce((sum, v, c) => sum + (v - lab[c]) ** 2, 0)
      if (d < error) { error = d; best = j }
    }
    const id = palette[best].id
    let index = result.paletteUsed.indexOf(id)
    if (index < 0) { index = result.paletteUsed.length; result.paletteUsed.push(id) }
    result.grid[i] = index
  }
  // Compact after contour restoration so removed base colors don't leak to UI.
  const compact = [], indices = new Map()
  for (let i = 0; i < result.grid.length; i++) {
    const old = result.grid[i]
    if (old === EMPTY) continue
    if (!indices.has(old)) { indices.set(old, compact.length); compact.push(result.paletteUsed[old]) }
    result.grid[i] = indices.get(old)
  }
  progress(100)
  return { grid: result.grid, paletteUsed: compact }
}
