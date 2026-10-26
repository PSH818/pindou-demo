/**
 * 纯渲染函数，无任何 React / Taro 依赖
 * 可在 Node.js 中直接单测
 */

import type { Pattern, BeadColor } from '../../types'
import { TRANSPARENT } from '../../types'

export interface RenderOptions {
  scale: number
  offsetX: number
  offsetY: number
  showGrid: boolean
  circular: boolean               // 圆形珠子模式（scale >= 10 时建议开启）
  highlightColorIdx: number | null // 高亮某个颜色（来自色板点击）
  showColorCode: boolean          // 在格子内显示色号（scale >= CODE_MIN_SCALE 时生效）
  showRuler?: boolean             // 显示行列编号标尺
  showGuideLines?: boolean        // 每 N 格加重划线
  guideLinesEvery?: number        // 划线间隔格数（默认 5）
  guideLinesColor?: string        // 划线颜色（默认 'rgba(0,0,0,0.35)'）
}

// 色号文字显示的最低 scale 阈值（px/格）：自动模式（已弃用，保留供外部引用）
export const CODE_MIN_SCALE = 20
// 开关打开时的较低 scale 阈值（px/格）
export const CODE_MIN_SCALE_TOGGLE = 12
// 标尺带宽（px，覆盖在 canvas 顶/左边缘）
export const RULER_PX = 20

// ─── 整数坐标辅助 ────────────────────────────────────────────
// 用 floor(next) - floor(cur) 而非直接取 round(scale)：
// 相邻格子宽度自动分配（7 或 8），既无缝隙也不重叠。

function cellPx(
  offsetX: number, offsetY: number, scale: number,
  cx: number, cy: number
): [px: number, py: number, pw: number, ph: number] {
  const px = Math.floor(offsetX + cx * scale)
  const py = Math.floor(offsetY + cy * scale)
  const pw = Math.floor(offsetX + (cx + 1) * scale) - px
  const ph = Math.floor(offsetY + (cy + 1) * scale) - py
  return [px, py, pw, ph]
}

// ─── 全量渲染 ────────────────────────────────────────────────

export function renderFull(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  pattern: Pattern,
  allColors: BeadColor[],
  opts: RenderOptions
): void {
  ctx.clearRect(0, 0, canvasW, canvasH)
  drawBackground(ctx, pattern, opts)
  drawCells(ctx, pattern, allColors, opts)
  if (opts.showGrid && opts.scale >= 5) {
    drawGrid(ctx, canvasW, canvasH, pattern, opts)
  }
  if (opts.showGuideLines) {
    drawGuideLines(ctx, canvasW, canvasH, pattern, opts)
  }
  if (opts.showColorCode) {
    drawColorCodes(ctx, pattern, allColors, opts)
  }
  if (opts.highlightColorIdx !== null) {
    drawHighlightBorder(ctx, pattern, opts)
  }
  if (opts.showRuler) {
    drawRuler(ctx, canvasW, canvasH, pattern, opts)
  }
}

// ─── 单格局部更新（画笔拖动时用，避免全量重绘）───────────────

export function renderSingleCell(
  ctx: CanvasRenderingContext2D,
  cellX: number,
  cellY: number,
  pattern: Pattern,
  allColors: BeadColor[],
  opts: RenderOptions
): void {
  const { scale, offsetX, offsetY, circular } = opts
  const [px, py, pw, ph] = cellPx(offsetX, offsetY, scale, cellX, cellY)

  // 清除并重绘背景色（fillRect 覆盖完整清除区域，避免透明缝隙露出白色底层）
  ctx.clearRect(px - 1, py - 1, pw + 2, ph + 2)
  ctx.fillStyle = BG_COLOR
  ctx.fillRect(px - 1, py - 1, pw + 2, ph + 2)

  const idx = pattern.grid[cellY * pattern.width + cellX]
  let color: BeadColor | undefined

  if (idx !== TRANSPARENT) {
    const colorId = pattern.paletteUsed[idx]
    color = allColors.find(c => c.id === colorId)
    if (color) {
      ctx.globalAlpha = (opts.highlightColorIdx !== null && idx !== opts.highlightColorIdx) ? 0.18 : 1
      ctx.fillStyle = rgbStr(color.rgb)
      drawBeadBody(ctx, px, py, pw, ph, circular)
      if (circular) {
        ctx.fillStyle = HOLE_COLOR
        drawBeadHole(ctx, px, py, pw, ph)
      }
    }
  }

  ctx.globalAlpha = 1

  // 补回网格线
  if (opts.showGrid && scale >= 5) {
    ctx.strokeStyle = GRID_COLOR
    ctx.lineWidth = 1
    ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1)
  }

  // 补回色号文字
  if (opts.showColorCode && color && (opts.highlightColorIdx === null || idx === opts.highlightColorIdx)) {
    const fontSize = Math.max(6, Math.floor(scale * 0.40))
    ctx.font = `bold ${fontSize}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = contrastColor(color.rgb)
    ctx.fillText(color.code, px + pw / 2, py + ph / 2)
  }
  if (idx !== TRANSPARENT && idx === opts.highlightColorIdx) {
    const lw = Math.max(1.5, Math.min(pw, ph) * 0.07)
    ctx.strokeStyle = HIGHLIGHT_COLOR
    ctx.lineWidth = lw
    ctx.strokeRect(px + lw / 2, py + lw / 2, pw - lw, ph - lw)
  }
}

// ─── 内部实现 ────────────────────────────────────────────────

const BG_COLOR      = '#ece8e0'   // 暖米白，仿 Artkal 珠板底色
const HOLE_COLOR    = '#bfb8b0'   // 珠孔阴影色，比底板略深
const GRID_COLOR    = 'rgba(0,0,0,0.10)'
const HIGHLIGHT_COLOR = '#ff6200'

function drawBackground(
  ctx: CanvasRenderingContext2D,
  pattern: Pattern,
  { scale, offsetX, offsetY }: RenderOptions
) {
  const x0 = Math.floor(offsetX)
  const y0 = Math.floor(offsetY)
  const x1 = Math.floor(offsetX + pattern.width  * scale)
  const y1 = Math.floor(offsetY + pattern.height * scale)
  ctx.fillStyle = BG_COLOR
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
}

function drawCells(
  ctx: CanvasRenderingContext2D,
  pattern: Pattern,
  allColors: BeadColor[],
  opts: RenderOptions
) {
  const { scale, offsetX, offsetY, circular, highlightColorIdx } = opts
  const { width, grid, paletteUsed } = pattern

  const colorById = new Map(allColors.map(c => [c.id, c.rgb as [number, number, number]]))
  const idxToRgb: Array<[number, number, number] | null> = paletteUsed.map(id => colorById.get(id) ?? null)

  // 按颜色分组，同色批量绘制（减少 fillStyle 切换次数）
  const groups = new Map<number, number[]>()
  for (let i = 0; i < grid.length; i++) {
    const ci = grid[i]
    if (ci === TRANSPARENT) continue
    let arr = groups.get(ci)
    if (!arr) { arr = []; groups.set(ci, arr) }
    arr.push(i)
  }

  // Pass 1: 珠子本体（按颜色分组批量）
  for (const [colorIdx, cellList] of groups) {
    const rgb = idxToRgb[colorIdx]
    if (!rgb) continue
    ctx.globalAlpha = (highlightColorIdx !== null && colorIdx !== highlightColorIdx) ? 0.18 : 1
    ctx.fillStyle = rgbStr(rgb)
    for (const ci of cellList) {
      const cx = ci % width
      const cy = Math.floor(ci / width)
      const [px, py, pw, ph] = cellPx(offsetX, offsetY, scale, cx, cy)
      drawBeadBody(ctx, px, py, pw, ph, circular)
    }
  }

  // Pass 2: 珠孔（单色，一次批量）
  // 圆心孔洞让珠板颜色透出来，是拼豆图纸区别于像素画的核心视觉特征
  if (circular) {
    ctx.globalAlpha = 1
    ctx.fillStyle   = HOLE_COLOR
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === TRANSPARENT) continue
      ctx.globalAlpha = (highlightColorIdx !== null && grid[i] !== highlightColorIdx) ? 0.18 : 1
      const cx = i % width
      const cy = Math.floor(i / width)
      const [px, py, pw, ph] = cellPx(offsetX, offsetY, scale, cx, cy)
      drawBeadHole(ctx, px, py, pw, ph)
    }
  }

  ctx.globalAlpha = 1
}

function drawColorCodes(
  ctx: CanvasRenderingContext2D,
  pattern: Pattern,
  allColors: BeadColor[],
  { scale, offsetX, offsetY, highlightColorIdx }: RenderOptions
) {
  const { width, grid, paletteUsed } = pattern
  const colorById = new Map(allColors.map(c => [c.id, c]))

  // paletteUsed 下标 → { code, textColor }，避免每格查 Map
  type CodeInfo = { code: string; textColor: string }
  const idxToInfo: Array<CodeInfo | null> = paletteUsed.map(id => {
    const c = colorById.get(id)
    if (!c) return null
    return { code: c.code, textColor: contrastColor(c.rgb) }
  })

  const fontSize = Math.max(6, Math.floor(scale * 0.40))
  ctx.font = `bold ${fontSize}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (let i = 0; i < grid.length; i++) {
    const ci = grid[i]
    if (ci === TRANSPARENT) continue
    if (highlightColorIdx !== null && ci !== highlightColorIdx) continue
    const info = idxToInfo[ci]
    if (!info) continue

    const cx = i % width
    const cy = Math.floor(i / width)
    const [px, py, pw, ph] = cellPx(offsetX, offsetY, scale, cx, cy)
    ctx.fillStyle = info.textColor
    ctx.fillText(info.code, px + pw / 2, py + ph / 2)
  }
}

// 珠子本体：circular=true 时画圆，太小（r<1.5）时退化为方块
function drawBeadBody(
  ctx: CanvasRenderingContext2D,
  px: number, py: number,
  pw: number, ph: number,
  circular: boolean
) {
  const gap = pw > 5 ? 1 : 0
  if (circular) {
    const r = (Math.min(pw, ph) - gap * 2) / 2 * 0.88
    if (r >= 1.5) {
      ctx.beginPath()
      ctx.arc(px + pw / 2, py + ph / 2, r, 0, Math.PI * 2)
      ctx.fill()
      return
    }
  }
  ctx.fillRect(px + gap, py + gap, pw - gap * 2, ph - gap * 2)
}

// 珠孔：在珠子圆心画小圆，露出珠板底色，模拟拼豆的孔洞质感
// 只有圆形模式且 r 够大时才有效果
function drawBeadHole(
  ctx: CanvasRenderingContext2D,
  px: number, py: number,
  pw: number, ph: number
) {
  const gap  = pw > 5 ? 1 : 0
  const r    = (Math.min(pw, ph) - gap * 2) / 2 * 0.88
  if (r < 1.5) return   // 方块模式，不需要孔
  const hole = r * 0.42
  if (hole < 0.8) return // 孔太小，画了也看不见
  ctx.beginPath()
  ctx.arc(px + pw / 2, py + ph / 2, hole, 0, Math.PI * 2)
  ctx.fill()
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  canvasW: number, canvasH: number,
  pattern: Pattern,
  { scale, offsetX, offsetY }: RenderOptions
) {
  const { width, height } = pattern

  const x0 = Math.floor(offsetX)
  const y0 = Math.floor(offsetY)
  const x1 = Math.floor(offsetX + width  * scale)
  const y1 = Math.floor(offsetY + height * scale)

  ctx.save()
  ctx.beginPath()
  ctx.rect(
    Math.max(0, x0),
    Math.max(0, y0),
    Math.min(canvasW, x1) - Math.max(0, x0),
    Math.min(canvasH, y1) - Math.max(0, y0)
  )
  ctx.clip()

  ctx.strokeStyle = GRID_COLOR
  ctx.lineWidth = 1
  ctx.beginPath()

  const colStart = Math.max(0, Math.floor(-offsetX / scale))
  const colEnd   = Math.min(width, Math.ceil((canvasW - offsetX) / scale))
  for (let c = colStart; c <= colEnd; c++) {
    const x = Math.round(offsetX + c * scale)
    ctx.moveTo(x, Math.max(0, y0))
    ctx.lineTo(x, Math.min(canvasH, y1))
  }

  const rowStart = Math.max(0, Math.floor(-offsetY / scale))
  const rowEnd   = Math.min(height, Math.ceil((canvasH - offsetY) / scale))
  for (let r = rowStart; r <= rowEnd; r++) {
    const y = Math.round(offsetY + r * scale)
    ctx.moveTo(Math.max(0, x0), y)
    ctx.lineTo(Math.min(canvasW, x1), y)
  }

  ctx.stroke()
  ctx.restore()
}

function drawGuideLines(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  pattern: Pattern,
  opts: RenderOptions
) {
  const { scale, offsetX, offsetY } = opts
  const { width, height } = pattern
  const every = opts.guideLinesEvery ?? 5
  const color = opts.guideLinesColor ?? 'rgba(0,0,0,0.35)'

  const x0 = Math.floor(offsetX)
  const y0 = Math.floor(offsetY)
  const x1 = Math.floor(offsetX + width  * scale)
  const y1 = Math.floor(offsetY + height * scale)

  ctx.save()
  ctx.beginPath()
  ctx.rect(
    Math.max(0, x0),
    Math.max(0, y0),
    Math.min(canvasW, x1) - Math.max(0, x0),
    Math.min(canvasH, y1) - Math.max(0, y0)
  )
  ctx.clip()

  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.beginPath()

  for (let c = 0; c <= width; c++) {
    if (c % every !== 0) continue
    const x = Math.round(offsetX + c * scale)
    ctx.moveTo(x, Math.max(0, y0))
    ctx.lineTo(x, Math.min(canvasH, y1))
  }
  for (let r = 0; r <= height; r++) {
    if (r % every !== 0) continue
    const y = Math.round(offsetY + r * scale)
    ctx.moveTo(Math.max(0, x0), y)
    ctx.lineTo(Math.min(canvasW, x1), y)
  }

  ctx.stroke()
  ctx.restore()
}

function drawHighlightBorder(
  ctx: CanvasRenderingContext2D,
  pattern: Pattern,
  { scale, offsetX, offsetY, highlightColorIdx }: RenderOptions
) {
  const { width, grid } = pattern

  ctx.strokeStyle = HIGHLIGHT_COLOR

  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== highlightColorIdx) continue
    const cx = i % width
    const cy = Math.floor(i / width)
    const [px, py, pw, ph] = cellPx(offsetX, offsetY, scale, cx, cy)
    const lw = Math.max(1.5, Math.min(pw, ph) * 0.07)
    ctx.lineWidth = lw
    ctx.strokeRect(px + lw / 2, py + lw / 2, pw - lw, ph - lw)
  }
}

function contrastColor([r, g, b]: [number, number, number]): string {
  // sRGB 感知亮度，决定文字用深色还是浅色
  const L = 0.299 * r + 0.587 * g + 0.114 * b
  return L > 140 ? 'rgba(0,0,0,0.72)' : 'rgba(255,255,255,0.88)'
}

// ─── 行列编号标尺（四边）──────────────────────────────────────────

function drawRuler(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  pattern: Pattern,
  { scale, offsetX, offsetY }: RenderOptions
) {
  const { width, height } = pattern
  const RULER_BG     = 'rgba(250, 247, 243, 0.97)'
  const RULER_BORDER = 'rgba(237, 208, 184, 0.9)'
  const RULER_TEXT   = '#9B7E72'
  const fs = Math.max(8, Math.min(11, Math.floor(RULER_PX * 0.52)))

  ctx.save()
  ctx.font = `${fs}px sans-serif`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'

  // 四条标尺背景（左右先画覆盖全高，上下只画中间段）
  ctx.fillStyle = RULER_BG
  ctx.fillRect(0, 0, RULER_PX, canvasH)                          // 左
  ctx.fillRect(canvasW - RULER_PX, 0, RULER_PX, canvasH)         // 右
  ctx.fillRect(RULER_PX, 0, canvasW - RULER_PX * 2, RULER_PX)   // 上（不覆盖角）
  ctx.fillRect(RULER_PX, canvasH - RULER_PX, canvasW - RULER_PX * 2, RULER_PX) // 下

  // 边框线
  ctx.fillStyle = RULER_BORDER
  ctx.fillRect(RULER_PX - 1, 0, 1, canvasH)                           // 左内边
  ctx.fillRect(canvasW - RULER_PX, 0, 1, canvasH)                     // 右内边
  ctx.fillRect(RULER_PX, RULER_PX - 1, canvasW - RULER_PX * 2, 1)    // 上内边
  ctx.fillRect(RULER_PX, canvasH - RULER_PX, canvasW - RULER_PX * 2, 1) // 下内边

  // 列编号（上 + 下）
  ctx.fillStyle = RULER_TEXT
  const colStart = Math.max(0, Math.floor(-offsetX / scale))
  const colEnd   = Math.min(width - 1, Math.ceil((canvasW - offsetX) / scale))
  let lastRight  = RULER_PX

  for (let c = colStart; c <= colEnd; c++) {
    const [px, , pw] = cellPx(offsetX, offsetY, scale, c, 0)
    const cx = px + pw / 2
    if (cx <= RULER_PX || cx >= canvasW - RULER_PX) continue
    const label = String(c + 1)
    const lw = ctx.measureText(label).width
    if (cx - lw / 2 < lastRight + 2) continue
    lastRight = cx + lw / 2
    ctx.fillText(label, cx, RULER_PX / 2)                        // 上
    ctx.fillText(label, cx, canvasH - RULER_PX / 2)              // 下
  }

  // 行编号（左 + 右）
  const rowStart  = Math.max(0, Math.floor(-offsetY / scale))
  const rowEnd    = Math.min(height - 1, Math.ceil((canvasH - offsetY) / scale))
  let lastBottom  = RULER_PX

  for (let r = rowStart; r <= rowEnd; r++) {
    const [, py, , ph] = cellPx(offsetX, offsetY, scale, 0, r)
    const cy = py + ph / 2
    if (cy <= RULER_PX || cy >= canvasH - RULER_PX) continue
    const label = String(r + 1)
    if (cy - fs / 2 < lastBottom + 2) continue
    lastBottom = cy + fs / 2
    ctx.fillText(label, RULER_PX / 2, cy)                        // 左
    ctx.fillText(label, canvasW - RULER_PX / 2, cy)              // 右
  }

  ctx.restore()
}

function rgbStr([r, g, b]: [number, number, number]): string {
  return `rgb(${r},${g},${b})`
}
