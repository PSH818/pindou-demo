/** Conservative color-connected matting for near-uniform cartoon backgrounds.
 * Returns null when evidence is weak; never uses a semantic/person silhouette.
 */
const distance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

export function removeFlatBackground(src, w, h) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 3 || h < 3 || w * h > 16000000 || src.length !== w * h * 4) return null
  const rgb = (x, y) => { const p = (y * w + x) * 4; return [src[p], src[p + 1], src[p + 2]] }
  let left = 0, right = w - 1, top = 0, bottom = h - 1
  // Remove only flat, achromatic screenshot/letterbox strips. Do not trim the
  // colored backdrop or a character merely touching the source image edges.
  const flat = (horizontal, coordinate) => {
    const start = horizontal ? left : top, end = horizontal ? right : bottom
    const color = horizontal ? rgb(start, coordinate) : rgb(coordinate, start)
    // Thin, full-width colored UI separators are also framing, not subject.
    if (Math.max(...color) - Math.min(...color) > 12 && (!horizontal || (coordinate > h * .04 && coordinate < h * .96))) return false
    let exceptions = 0
    for (let i = start; i <= end; i++) {
      // A screenshot can contain an isolated cursor/compression speck in a
      // frame. Inspect every pixel, allowing at most 0.5% exceptions.
      if (distance(color, horizontal ? rgb(i, coordinate) : rgb(coordinate, i)) > 5 ** 2 &&
        ++exceptions > Math.floor((end - start + 1) * .005)) return false
    }
    return true
  }
  for (let pass = 0; pass < 2; pass++) {
    while (top < h * .12 && flat(true, top)) top++
    while (bottom > h * .88 && flat(true, bottom)) bottom--
    while (left < w * .12 && flat(false, left)) left++
    while (right > w * .88 && flat(false, right)) right--
  }
  if (right - left < w * .6 || bottom - top < h * .6) return null
  const patch = Math.max(2, Math.min(12, Math.floor(Math.min(w, h) * .015)))
  const corners = [[left, top], [right - patch + 1, top], [left, bottom - patch + 1], [right - patch + 1, bottom - patch + 1]]
  const samples = corners.map(([x, y]) => {
    const values = []
    for (let yy = y; yy < y + patch; yy++) for (let xx = x; xx < x + patch; xx++) {
      if (src[(yy * w + xx) * 4 + 3] >= 128) values.push(rgb(xx, yy))
    }
    if (values.length < patch * patch * .8) return null
    const median = [0, 1, 2].map(c => values.map(v => v[c]).sort((a, b) => a - b)[Math.floor(values.length / 2)])
    return values.filter(v => distance(v, median) < 18 ** 2).length >= values.length * .9 ? median : null
  })
  let group = []
  for (const color of samples) {
    if (!color) continue
    const matches = samples.map((c, i) => c && distance(c, color) < 35 ** 2 ? i : -1).filter(i => i >= 0)
    if (matches.length > group.length) group = matches
  }
  if (group.length < 3) return null
  const bg = [0, 1, 2].map(c => group.reduce((sum, i) => sum + samples[i][c], 0) / group.length)
  // Fixed reference prevents a gradual walk from background into the subject.
  const mask = new Uint8Array(w * h), queue = new Int32Array(w * h)
  let head = 0, tail = 0
  const seed = (x, y) => {
    const i = y * w + x
    if (mask[i]) return
    if (src[i * 4 + 3] < 16 || distance(rgb(x, y), bg) <= 38 ** 2) {
      mask[i] = 1; queue[tail++] = i
    }
  }
  // Corner seeds, not every border pixel: a same-colored body touching the
  // bottom must not be seeded from inside its enclosing outline.
  for (const c of group) {
    const [x, y] = corners[c]
    for (let yy = y; yy < y + patch; yy++) for (let xx = x; xx < x + patch; xx++) seed(xx, yy)
  }
  while (head < tail) {
    const i = queue[head++], x = i % w, y = Math.floor(i / w)
    if (x > left) seed(x - 1, y)
    if (x < right) seed(x + 1, y)
    if (y > top) seed(x, y - 1)
    if (y < bottom) seed(x, y + 1)
  }
  const area = (right - left + 1) * (bottom - top + 1)
  if (tail < area * .08 || tail > area * .96) return null
  const out = src.slice()
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x
    if (x < left || x > right || y < top || y > bottom || mask[i]) { out[i * 4 + 3] = 0; continue }
    if (!src[i * 4 + 3]) continue
    let boundary = false
    for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (n >= 0 && mask[n]) boundary = true
    }
    if (!boundary) continue
    const color = rgb(x, y)
    const local = [0, 0, 0]
    let localCount = 0
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const xx = x + dx, yy = y + dy
      if (xx < left || xx > right || yy < top || yy > bottom || !mask[yy * w + xx]) continue
      const candidate = rgb(xx, yy)
      if (src[(yy * w + xx) * 4 + 3] >= 250 && distance(candidate, bg) < 25 ** 2) {
        for (let c = 0; c < 3; c++) local[c] += candidate[c]
        localCount++
      }
    }
    const edgeBg = localCount ? local.map(v => v / localCount) : bg
    // Decontaminate only an edge whose color lies on the line between a nearby
    // solid foreground pixel and the background. Opaque interior is untouched.
    let foreground = color, best = distance(color, edgeBg)
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy
      if (xx < left || xx > right || yy < top || yy > bottom || mask[yy * w + xx] || src[(yy * w + xx) * 4 + 3] < 250) continue
      const candidate = rgb(xx, yy), d = distance(candidate, edgeBg)
      if (d > best) { best = d; foreground = candidate }
    }
    const vector = foreground.map((v, c) => v - edgeBg[c])
    const denominator = vector.reduce((sum, v) => sum + v * v, 0)
    const alpha = Math.max(0, Math.min(1, vector.reduce((sum, v, c) => sum + (color[c] - edgeBg[c]) * v, 0) / (denominator || 1)))
    const predicted = vector.map((v, c) => edgeBg[c] + alpha * v)
    if (alpha > .08 && alpha < .98 && distance(predicted, color) < 14 ** 2) {
      out[i * 4 + 3] = Math.round(src[i * 4 + 3] * alpha)
      for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.max(0, Math.min(255, Math.round((color[c] - (1 - alpha) * edgeBg[c]) / alpha)))
    }
  }
  return { rgba: out, background: bg }
}
