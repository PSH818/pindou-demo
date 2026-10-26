/** Locate an axis-aligned chart inside a screenshot/export. Chart analysis only.
 * Absolute RGB edge support avoids cancellation on alternating light/dark cells.
 * A lattice must have consecutive supporting lines, not just a strong harmonic.
 */
function edgeProfile(rgba, width, rect, horizontal) {
  const length = horizontal ? rect.w : rect.h
  const cross = horizontal ? rect.h : rect.w
  const profile = new Float32Array(length)
  const samples = Math.min(cross, 192)
  for (let s = 0; s < samples; s++) {
    // Stagger within each stratum: a scan interval equal to the cell size must
    // not put every scan onto the orthogonal grid lines (especially thick ones).
    const phase = 0.2 + (s * 0.61803398875 % 1) * 0.6
    const offset = Math.min(cross - 1, Math.floor((s + phase) * cross / samples))
    for (let p = 0; p < length - 1; p++) {
      const x = rect.x + (horizontal ? p : offset)
      const y = rect.y + (horizontal ? offset : p)
      const a = (y * width + x) * 4
      const b = a + (horizontal ? 4 : width * 4)
      const aa = rgba[a + 3] / 255, ab = rgba[b + 3] / 255
      let difference = 0
      for (let c = 0; c < 3; c++) {
        difference = Math.max(difference, Math.abs(
          rgba[a + c] * aa + 255 * (1 - aa) - rgba[b + c] * ab - 255 * (1 - ab),
        ))
      }
      if (difference >= 12) profile[p] += 1 / samples
    }
  }
  return profile
}

function findAxis(profile) {
  const n = profile.length
  let maximum = 0
  for (const v of profile) maximum = Math.max(maximum, v)
  if (maximum < 0.18) return null
  const threshold = Math.max(0.18, maximum * 0.42)
  const peaks = []
  for (let i = 0; i < n; i++) {
    if (profile[i] < threshold) continue
    const start = i
    let sum = 0, weighted = 0
    while (i < n && profile[i] >= threshold) {
      sum += profile[i]; weighted += (i + 0.5) * profile[i]; i++
    }
    // Broad blocks are content, not narrow line edges.
    if (i - start <= 12) peaks.push(weighted / sum)
  }
  if (peaks.length < 5 || peaks.length > 1200) return null
  const votes = new Map()
  for (let i = 0; i < peaks.length; i++) {
    for (let j = i + 1; j < Math.min(i + 5, peaks.length); j++) {
      const d = peaks[j] - peaks[i]
      if (d < 3 || d > 256) continue
      const bin = Math.round(d * 2) / 2
      votes.set(bin, (votes.get(bin) || 0) + 1)
    }
  }
  const periods = [...votes].sort((a, b) => b[1] - a[1]).slice(0, 32).map(([p]) => p)
  let best = null
  for (const period of periods) {
    const tolerance = Math.min(period * 0.2, Math.max(2.5, Math.min(4, period * 0.1)))
    for (let start = 0; start < peaks.length - 4; start++) {
      const points = [peaks[start]]
      let cursor = start + 1
      // Fit after every match so fractional cell sizes don't accumulate drift.
      let step = period
      while (cursor < peaks.length) {
        const target = points[0] + points.length * step
        while (cursor < peaks.length && peaks[cursor] < target - tolerance) cursor++
        if (cursor === peaks.length || peaks[cursor] > target + tolerance) break
        if (cursor + 1 < peaks.length && Math.abs(peaks[cursor + 1] - target) < Math.abs(peaks[cursor] - target)) cursor++
        points.push(peaks[cursor++])
        step = (points[points.length - 1] - points[0]) / (points.length - 1)
      }
      if (points.length < 5) continue
      // Do not let a nearby coordinate label join the first line and gradually
      // bend the fitted lattice into the chart. Every actual gap must agree.
      if (points.some((p, i) => i > 0 && Math.abs(p - points[i - 1] - step) > tolerance)) continue
      const span = points[points.length - 1] - points[0]
      if (span < n * 0.3) continue
      const score = span * Math.sqrt(points.length - 1)
      if (!best || score > best.score) best = { start: points[0], end: points[points.length - 1], period: step, score }
    }
  }
  if (!best) return null
  // A tightly cropped chart may omit its final border or clip a thick first line.
  if (best.start < best.period * 0.55) best.start = 0
  if (n - best.end < best.period * 1.15) best.end = n
  const count = Math.round((best.end - best.start) / best.period)
  const residual = Math.abs((best.end - best.start) / best.period - count)
  if (residual > 0.18 || count < 4) return null
  return { start: best.start, end: best.end, count, period: best.period }
}

export function locateChartGrid(rgba, width, height, rect = { x: 0, y: 0, w: width, h: height }) {
  const horizontal = findAxis(edgeProfile(rgba, width, rect, true))
  const vertical = findAxis(edgeProfile(rgba, width, rect, false))
  if (!horizontal || !vertical) return null
  const crop = {
    x: rect.x + Math.round(horizontal.start),
    y: rect.y + Math.round(vertical.start),
    w: Math.round(horizontal.end - horizontal.start),
    h: Math.round(vertical.end - vertical.start),
  }
  // Both independent line families must form a substantial rectangular region.
  if (crop.w * crop.h < rect.w * rect.h * 0.2) return null
  return { crop, cols: horizontal.count, rows: vertical.count }
}
