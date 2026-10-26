/** Sample a chart cell's background, not its central printed label.
 * Returns null when fewer than half of the interior samples are opaque enough.
 * Pure helper used only by chart analysis; photo conversion is independent.
 */
export function sampleCellBackground(rgba, imgW, imgH, left, top, width, height) {
  const bounds = (start, size, limit) => {
    const inset = Math.max(0, Math.min(size * 0.15, (size - 1) / 2))
    const low = Math.max(0, Math.ceil(start + inset - 0.5))
    const high = Math.min(limit - 1, Math.ceil(start + size - inset - 0.5) - 1)
    if (low <= high) return [low, high]
    const center = Math.max(0, Math.min(limit - 1, Math.floor(start + size / 2)))
    return [center, center]
  }
  const [x0, x1] = bounds(left, width, imgW)
  const [y0, y1] = bounds(top, height, imgH)
  const nx = Math.min(16, x1 - x0 + 1), ny = Math.min(16, y1 - y0 + 1)
  const bins = new Map()
  let opaqueSamples = 0
  // Avoid grid lines, sample across the interior, and favor the outer interior
  // where labels are less likely. Never assume text is black or background bright.
  for (let y = 0; y < ny; y++) {
    const py = y0 + Math.floor((y + 0.5) * (y1 - y0 + 1) / ny)
    for (let x = 0; x < nx; x++) {
      const px = x0 + Math.floor((x + 0.5) * (x1 - x0 + 1) / nx)
      const i = (py * imgW + px) * 4
      if (rgba[i + 3] < 128) continue
      opaqueSamples++
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2]
      const fx = (px + 0.5 - left) / width, fy = (py + 0.5 - top) / height
      let contrast = 0
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const neighbor = (Math.max(y0, Math.min(y1, py + dy)) * imgW + Math.max(x0, Math.min(x1, px + dx))) * 4
        if (rgba[neighbor + 3] < 128) continue
        contrast += Math.max(Math.abs(r - rgba[neighbor]), Math.abs(g - rgba[neighbor + 1]), Math.abs(b - rgba[neighbor + 2])) / 4
      }
      // Text edges and JPEG ringing are less trustworthy than flat fill patches.
      const weight = (fx < 0.3 || fx > 0.7 || fy < 0.3 || fy > 0.7 ? 2 : 1) / (1 + contrast / 12) ** 2
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      const bin = bins.get(key) ?? { key, weight: 0, r: 0, g: 0, b: 0 }
      bin.weight += weight; bin.r += r * weight; bin.g += g * weight; bin.b += b * weight
      bins.set(key, bin)
    }
  }
  // Empty cells (including sparse text/edge artifacts on transparent fill) are
  // not white beads. Real opaque white remains a normal color candidate.
  if (bins.size === 0 || opaqueSamples * 2 < nx * ny) return null
  for (const bin of bins.values()) {
    bin.r /= bin.weight; bin.g /= bin.weight; bin.b /= bin.weight
  }
  let bestWeight = -1, best = [255, 255, 255]
  // Merge nearby RGB bins before voting so compression noise/bin boundaries do
  // not split the background into smaller groups than the printed text.
  for (const seed of bins.values()) {
    let weight = 0, r = 0, g = 0, b = 0
    const qr = seed.key >> 8, qg = (seed.key >> 4) & 15, qb = seed.key & 15
    for (let cr = Math.max(0, qr - 1); cr <= Math.min(15, qr + 1); cr++) {
      for (let cg = Math.max(0, qg - 1); cg <= Math.min(15, qg + 1); cg++) {
        for (let cb = Math.max(0, qb - 1); cb <= Math.min(15, qb + 1); cb++) {
          const bin = bins.get((cr << 8) | (cg << 4) | cb)
          if (!bin || (bin.r - seed.r) ** 2 + (bin.g - seed.g) ** 2 + (bin.b - seed.b) ** 2 > 16 ** 2) continue
          weight += bin.weight; r += bin.r * bin.weight; g += bin.g * bin.weight; b += bin.b * bin.weight
        }
      }
    }
    if (weight > bestWeight) {
      bestWeight = weight
      best = [Math.round(r / weight), Math.round(g / weight), Math.round(b / weight)]
    }
  }
  return best
}
