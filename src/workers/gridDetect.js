/**
 * gridDetect.js — 图纸分析 Worker（ES Module）
 * 职责：网格检测 + 逐格颜色采样 + LAB 最近邻色板匹配
 * 约束：不能 import 任何 npm 包，不能访问 window/document
 */

import { sampleCellBackground } from './gridCellSample.js'
import { buildGridProfile, detectGridPeriod } from './gridPeriod.js'
import { locateChartGrid } from './gridLocate.js'

const TRANSPARENT = 0xFFFF // Same no-bead sentinel as src/types/index.ts.

// ─── 颜色工具（与 colorUtils.ts 保持一致）─────────────────────

function rgb2lab(r, g, b) {
  let rn = r / 255, gn = g / 255, bn = b / 255
  rn = rn > 0.04045 ? Math.pow((rn + 0.055) / 1.055, 2.4) : rn / 12.92
  gn = gn > 0.04045 ? Math.pow((gn + 0.055) / 1.055, 2.4) : gn / 12.92
  bn = bn > 0.04045 ? Math.pow((bn + 0.055) / 1.055, 2.4) : bn / 12.92
  const x = (rn * 0.4124564 + gn * 0.3575761 + bn * 0.1804375) / 0.95047
  const y = (rn * 0.2126729 + gn * 0.7151522 + bn * 0.0721750) / 1.00000
  const z = (rn * 0.0193339 + gn * 0.1191920 + bn * 0.9503041) / 1.08883
  const f = v => v > 0.008856 ? Math.pow(v, 1 / 3) : 7.787 * v + 16 / 116
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

function matchNearest(r, g, b, palette) {
  const [L, a, bv] = rgb2lab(r, g, b)
  let bestDist = Infinity, bestId = palette[0].id
  for (const c of palette) {
    const dL = L - c.lab[0], da = a - c.lab[1], db = bv - c.lab[2]
    const dist = dL * dL + da * da + db * db
    if (dist < bestDist) { bestDist = dist; bestId = c.id }
  }
  return bestId
}


// ─── Worker 主入口 ────────────────────────────────────────────

self.onmessage = function (e) {
  const {
    imageData, imageWidth: imgW, imageHeight: imgH,
    autoLocate = false,
    manualCols, manualRows,
    palette,
  } = e.data
  let { cropX, cropY, cropW, cropH } = e.data

  // Mirror the editor's 1–200 limit and reject invalid direct Worker messages.
  for (const [label, value] of [['列数', manualCols], ['行数', manualRows]]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 200)) {
      self.postMessage({ type: 'error', error: `${label}必须是 1–200 的整数` })
      return
    }
  }
  const rgba = new Uint8ClampedArray(imageData)

  self.postMessage({ type: 'progress', progress: 5 })

  // ── Step 1: 确定格子行列数 ───────────────────────────────────

  const MIN_CELL = 3, MAX_CELL = 80

  let cols = manualCols, rows = manualRows
  const geometry = autoLocate || cols === undefined || rows === undefined ? locateChartGrid(rgba, imgW, imgH, {
    x: cropX, y: cropY, w: cropW, h: cropH,
  }) : null
  const located = autoLocate ? geometry : null
  if (located) {
    ;({ x: cropX, y: cropY, w: cropW, h: cropH } = located.crop)
    cols ??= located.cols
    rows ??= located.rows
  } else if (geometry &&
    Math.abs(geometry.crop.x - cropX) <= cropW / geometry.cols * 0.15 &&
    Math.abs(geometry.crop.y - cropY) <= cropH / geometry.rows * 0.15 &&
    Math.abs(geometry.crop.w - cropW) <= cropW / geometry.cols * 0.15 &&
    Math.abs(geometry.crop.h - cropH) <= cropH / geometry.rows * 0.15) {
    // A user's crop stays authoritative; use the new spacing detector only
    // when its grid covers that crop, never silently shrink a manual selection.
    cols ??= geometry.cols
    rows ??= geometry.rows
  }
  if (cols === undefined) {
    const hProfile = buildGridProfile(rgba, imgW, imgH, cropX, cropY, cropW, cropH, true)
    const cellW = detectGridPeriod(hProfile, MIN_CELL, MAX_CELL)
    if (!cellW) {
      self.postMessage({ type: 'error', error: '无法自动识别列数，请手动输入列数' })
      return
    }
    cols = Math.max(1, Math.round(cropW / cellW))
  }
  if (rows === undefined) {
    const vProfile = buildGridProfile(rgba, imgW, imgH, cropX, cropY, cropW, cropH, false)
    const cellH = detectGridPeriod(vProfile, MIN_CELL, MAX_CELL)
    if (!cellH) {
      self.postMessage({ type: 'error', error: '无法自动识别行数，请手动输入行数' })
      return
    }
    rows = Math.max(1, Math.round(cropH / cellH))
  }

  self.postMessage({ type: 'progress', progress: 30 })

  if (cols > 200 || rows > 200) {
    self.postMessage({ type: 'error', error: `格子数量过多（${cols}×${rows}），请检查裁剪区域或手动输入正确行列数` })
    return
  }

  // ── Step 2: 逐格采样 + 色板匹配 ────────────────────────────

  const grid = new Uint16Array(cols * rows)
  // colorId → 在 paletteUsed 中的下标
  const colorIndexMap = new Map()
  const paletteUsed   = []

  const cellW = cropW / cols
  const cellH = cropH / rows

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const color = sampleCellBackground(
        rgba, imgW, imgH, cropX + col * cellW, cropY + row * cellH, cellW, cellH,
      )
      if (color === null) {
        grid[row * cols + col] = TRANSPARENT
        continue
      }
      const [r, g, b] = color
      const colorId = matchNearest(r, g, b, palette)

      let idx
      if (colorIndexMap.has(colorId)) {
        idx = colorIndexMap.get(colorId)
      } else {
        idx = paletteUsed.length
        paletteUsed.push(colorId)
        colorIndexMap.set(colorId, idx)
      }
      grid[row * cols + col] = idx
    }

    if (row % 8 === 0) {
      self.postMessage({ type: 'progress', progress: 30 + Math.round((row / rows) * 65) })
    }
  }

  self.postMessage({ type: 'progress', progress: 100 })
  self.postMessage(
    { type: 'result', grid: grid.buffer, paletteUsed, cols, rows,
      detectedCrop: located?.crop ?? null },
    [grid.buffer],
  )
}
