/** Chart-only grid detection. Signed edges distinguish a line's entrance/exit
 * from the next line. Photo conversion does not use this module.
 */
export function buildGridProfile(rgba, imgW, imgH, cropX, cropY, cropW, cropH, isX) {
  const size = isX ? cropW : cropH, other = isX ? cropH : cropW
  const profile = new Float32Array(size)
  const samples = Math.min(other, 40)
  for (let s = 0; s < samples; s++) {
    // Stratified, staggered scan positions avoid sampling only horizontal or
    // vertical grid lines when the image size is a multiple of the scan step.
    const offset = Math.min(other - 1, Math.floor((s + 0.25 + (s * 0.61803398875 % 1) * 0.5) * other / samples))
    for (let p = 0; p < size - 1; p++) {
      const x = cropX + (isX ? p : offset), y = cropY + (isX ? offset : p)
      const nx = x + (isX ? 1 : 0), ny = y + (isX ? 0 : 1)
      if (x < 0 || y < 0 || nx >= imgW || ny >= imgH) continue
      const a = (y * imgW + x) * 4, b = (ny * imgW + nx) * 4
      // Only grid detection composites onto white: hidden RGB must not create
      // fake edges, while opaque dark lines on a transparent chart stay visible.
      // Cell sampling below does NOT composite or turn transparency into white.
      const alphaA = rgba[a + 3] / 255, alphaB = rgba[b + 3] / 255
      const lumaA = (rgba[a] * 0.2126 + rgba[a + 1] * 0.7152 + rgba[a + 2] * 0.0722) * alphaA + 255 * (1 - alphaA)
      const lumaB = (rgba[b] * 0.2126 + rgba[b + 1] * 0.7152 + rgba[b + 2] * 0.0722) * alphaB + 255 * (1 - alphaB)
      profile[p] += (lumaB - lumaA) / samples
    }
  }
  return profile
}

export function detectGridPeriod(profile, minSize = 3, maxSize = 80) {
  const n = profile.length
  if (n < minSize * 3) return 0
  const smooth = new Float32Array(n)
  let energy = 0
  for (let i = 1; i < n - 1; i++) {
    smooth[i] = (profile[i - 1] + 2 * profile[i] + profile[i + 1]) / 4
    energy += smooth[i] ** 2
  }
  if (energy / n < 1) return 0
  const candidates = []
  // Test whole-cell counts directly: fractional cell sizes must not accumulate
  // rounding drift, and a stronger two-cell harmonic must not double the size.
  for (let count = Math.max(3, Math.ceil(n / maxSize)); count <= Math.min(300, Math.floor(n / minSize)); count++) {
    const period = n / count
    let dot = 0, leftEnergy = 0, rightEnergy = 0
    for (let i = 1; i + period < n - 2; i++) {
      const shifted = i + period, j = Math.floor(shifted), fraction = shifted - j
      const a = smooth[i], b = smooth[j] * (1 - fraction) + smooth[j + 1] * fraction
      dot += a * b; leftEnergy += a * a; rightEnergy += b * b
    }
    const score = dot / Math.sqrt(leftEnergy * rightEnergy || 1)
    candidates.push({ period, score })
  }
  const best = Math.max(0, ...candidates.map(c => c.score))
  if (best < 0.8) return 0
  const winner = candidates.find(c => c.score === best)
  // Smallest well-supported repeat wins over its multiples. Opposite edges of
  // a thick stroke correlate negatively and cannot become a false cell size.
  const strong = candidates.filter(c => {
    const multiple = winner.period / c.period
    return c.score >= Math.max(0.8, best - 0.025) &&
      (c === winner || (multiple >= 1.9 && Math.abs(multiple - Math.round(multiple)) < 0.015))
  })
  const chosen = strong[strong.length - 1]
  return chosen?.period ?? 0
}
