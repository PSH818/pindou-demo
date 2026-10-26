/**
 * PNG 导出工具
 * 离屏 Canvas 渲染图纸（含可选图例）→ 下载到本地
 */

import type { Pattern, BeadColor } from '../types'
import { renderFull } from '../components/PatternCanvas/renderer'
import { TRANSPARENT } from '../types'
import { showToast, downloadBlob } from './webUtils'
import { assertGridDimensions, assertSafeExportCanvas } from './patternLimits'

// ─── Design tokens ────────────────────────────────────────────

const C_BG       = '#FFFBF7'
const C_SEP      = '#EDD0B8'
const C_TEXT     = '#2C1810'
const C_TEXT_DIM = '#9B7E72'
const C_ACCENT   = '#F0874E'

// ─── 公开类型 ─────────────────────────────────────────────────

export interface PNGExportOpts {
  hd:              boolean   // false → 16px/格，true → 48px/格
  showGrid:        boolean
  showLegend:      boolean
  showRuler:       boolean   // 四边行列编号
  showColorCode:   boolean   // 珠子内色号（仅 hd 有效）
  showGuideLines?: boolean   // 每 N 格加重划线
  guideLinesEvery?: 5 | 10   // 划线间隔格数
  guideLinesColor?: string   // 划线颜色
}

// ─── 内部类型 ─────────────────────────────────────────────────

interface LegendItem {
  rgb:   [number, number, number]
  code:  string
  count: number
}

// ─── 图例数据 ─────────────────────────────────────────────────

export function buildLegendItems(pattern: Pattern, brandColors: BeadColor[]): LegendItem[] {
  const byId   = new Map(brandColors.map(c => [c.id, c]))
  const counts = new Map<number, number>()
  for (const v of pattern.grid) {
    if (v === TRANSPARENT) continue
    const id = pattern.paletteUsed[v]
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([id, count]) => {
      const c = byId.get(id)
      return c ? { rgb: c.rgb, code: c.code, count } : null
    })
    .filter(Boolean)
    .sort((a, b) => b!.count - a!.count) as LegendItem[]
}

// ─── 图例高度 ─────────────────────────────────────────────────

export function calcLegendHeight(items: LegendItem[], canvasW: number, cell: number): number {
  const colMinW = cell >= 20 ? 220 : 180
  const itemH   = cell >= 20 ? 52  : 42
  const pad     = 24
  const headerH = 70
  const cols    = Math.max(1, Math.floor((canvasW - pad * 2) / colMinW))
  const rows    = Math.ceil(items.length / cols)
  return 4 + headerH + rows * itemH + pad
}

// ─── 图例绘制 ─────────────────────────────────────────────────

export function drawLegend(
  ctx: CanvasRenderingContext2D,
  items: LegendItem[],
  canvasW: number,
  patH: number,
  cell: number,
  pattern: Pattern,
): void {
  const colMinW = cell >= 20 ? 220 : 180
  const itemH   = cell >= 20 ? 52  : 42
  const pad     = 24
  const headerH = 70
  const fs      = cell >= 20 ? 18 : 14
  const cols    = Math.max(1, Math.floor((canvasW - pad * 2) / colMinW))
  const colW    = (canvasW - pad * 2) / cols
  const dotR    = Math.round(fs * 0.65)

  let y = patH

  ctx.fillStyle = C_SEP
  ctx.fillRect(0, y, canvasW, 4)
  y += 4

  ctx.fillStyle = C_BG
  ctx.fillRect(0, y, canvasW, headerH)
  ctx.textBaseline = 'middle'

  ctx.font      = `bold ${fs + 2}px sans-serif`
  ctx.fillStyle = C_TEXT
  ctx.textAlign = 'left'
  ctx.fillText(pattern.name, pad, y + headerH / 2)

  const total = items.reduce((s, i) => s + i.count, 0)
  ctx.font      = `${fs}px sans-serif`
  ctx.fillStyle = C_TEXT_DIM
  ctx.textAlign = 'right'
  ctx.fillText(`${pattern.width}×${pattern.height}格 · ${total}粒`, canvasW - pad, y + headerH / 2)
  y += headerH

  ctx.fillStyle = C_SEP
  ctx.fillRect(0, y, canvasW, 2)
  y += 2 + 16

  ctx.textAlign    = 'left'
  ctx.textBaseline = 'middle'

  items.forEach((item, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x   = pad + col * colW
    const cy  = y + row * itemH + itemH / 2

    ctx.fillStyle = `rgb(${item.rgb[0]},${item.rgb[1]},${item.rgb[2]})`
    ctx.beginPath()
    ctx.arc(x + dotR, cy, dotR, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.10)'
    ctx.lineWidth   = 1
    ctx.stroke()

    ctx.font      = `bold ${fs}px sans-serif`
    ctx.fillStyle = C_TEXT
    ctx.fillText(item.code, x + dotR * 2 + 6, cy - 3)

    ctx.font      = `${Math.round(fs * 0.85)}px sans-serif`
    ctx.fillStyle = C_ACCENT
    ctx.fillText(`${item.count}粒`, x + dotR * 2 + 6, cy + fs * 0.72)
  })
}

// ─── PNG 主导出 ───────────────────────────────────────────────

export async function exportPatternToPNG(
  pattern: Pattern,
  brandColors: BeadColor[],
  opts: PNGExportOpts,
): Promise<void> {
  assertGridDimensions(pattern.width, pattern.height)
  const cell    = opts.hd ? 48 : 16
  const patW    = pattern.width  * cell
  const patH    = pattern.height * cell
  const rulerPx = opts.showRuler ? (opts.hd ? 32 : 20) : 0

  const items = opts.showLegend ? buildLegendItems(pattern, brandColors) : []
  const legW  = patW + rulerPx * 2
  const legH  = opts.showLegend && items.length > 0
    ? calcLegendHeight(items, legW, cell)
    : 0

  const totalW = patW + rulerPx * 2
  const totalH = patH + rulerPx * 2 + legH
  assertSafeExportCanvas(totalW, totalH)

  const canvas = document.createElement('canvas')
  canvas.width  = totalW
  canvas.height = totalH
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D

  ctx.fillStyle = C_BG
  ctx.fillRect(0, 0, totalW, totalH)

  renderFull(ctx, totalW, rulerPx * 2 + patH, pattern, brandColors, {
    scale:             cell,
    offsetX:           rulerPx,
    offsetY:           rulerPx,
    showGrid:          opts.showGrid,
    circular:          false,
    highlightColorIdx: null,
    showColorCode:     opts.showColorCode && opts.showGrid && cell >= 20,
    showGuideLines:    opts.showGuideLines,
    guideLinesEvery:   opts.guideLinesEvery,
    guideLinesColor:   opts.guideLinesColor,
  })

  if (opts.showRuler) {
    drawExportRuler(ctx, totalW, rulerPx, patW, patH, pattern, cell)
  }

  if (opts.showLegend && items.length > 0) {
    drawLegend(ctx, items, legW, rulerPx * 2 + patH, cell, pattern)
  }

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('渲染失败')), 'image/png')
  )
  const filename = `${pattern.name || '拼豆图纸'}.png`
  downloadBlob(blob, filename)
  showToast('已保存到本地')
}

// ─── 导出图标尺（四边行列编号）────────────────────────────────────

function drawExportRuler(
  ctx: CanvasRenderingContext2D,
  totalW: number,
  rulerPx: number,
  patW: number,
  patH: number,
  pattern: Pattern,
  cell: number,
): void {
  const { width, height } = pattern
  const fs   = Math.max(10, Math.floor(rulerPx * 0.55))
  const C_RBG  = '#F0EAE2'
  const C_RTXT = '#9B7E72'
  const C_RLINE = C_SEP

  ctx.save()
  ctx.font = `${fs}px sans-serif`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'

  // 顶部 & 底部背景
  ctx.fillStyle = C_RBG
  ctx.fillRect(rulerPx, 0, patW, rulerPx)
  ctx.fillRect(rulerPx, rulerPx + patH, patW, rulerPx)
  // 左侧 & 右侧背景
  const rulerTotalH = patH + rulerPx * 2
  ctx.fillRect(0, 0, rulerPx, rulerTotalH)                  // 左列（覆盖全高）
  ctx.fillRect(rulerPx + patW, 0, rulerPx, rulerTotalH)     // 右列

  // 刻度线
  ctx.strokeStyle = C_RLINE
  ctx.lineWidth = 1
  ctx.beginPath()
  // 顶部内边线
  ctx.moveTo(rulerPx, rulerPx); ctx.lineTo(rulerPx + patW, rulerPx)
  // 底部内边线
  ctx.moveTo(rulerPx, rulerPx + patH); ctx.lineTo(rulerPx + patW, rulerPx + patH)
  // 左侧内边线
  ctx.moveTo(rulerPx, 0); ctx.lineTo(rulerPx, rulerPx * 2 + patH)
  // 右侧内边线
  ctx.moveTo(rulerPx + patW, 0); ctx.lineTo(rulerPx + patW, rulerPx * 2 + patH)
  ctx.stroke()

  // 列编号：跳过间距不够的标签
  ctx.fillStyle = C_RTXT
  const colLabelW = ctx.measureText(String(width)).width
  const colStep   = Math.max(1, Math.ceil((colLabelW + 6) / cell))
  for (let c = 0; c < width; c++) {
    if (c % colStep !== 0 && c !== width - 1) continue
    const cx = rulerPx + (c + 0.5) * cell
    ctx.fillText(String(c + 1), cx, rulerPx / 2)           // 上
    ctx.fillText(String(c + 1), cx, rulerPx + patH + rulerPx / 2)  // 下
  }

  // 行编号
  const rowLabelW = ctx.measureText(String(height)).width
  const rowStep   = Math.max(1, Math.ceil((fs + 4) / cell))
  for (let r = 0; r < height; r++) {
    if (r % rowStep !== 0 && r !== height - 1) continue
    const cy = rulerPx + (r + 0.5) * cell
    ctx.fillText(String(r + 1), rulerPx / 2, cy)               // 左
    ctx.fillText(String(r + 1), rulerPx + patW + rulerPx / 2, cy)  // 右
  }

  // 四角填色
  ctx.fillStyle = C_RBG
  ctx.fillRect(0, 0, rulerPx, rulerPx)
  ctx.fillRect(rulerPx + patW, 0, rulerPx, rulerPx)
  ctx.fillRect(0, rulerPx + patH, rulerPx, rulerPx)
  ctx.fillRect(rulerPx + patW, rulerPx + patH, rulerPx, rulerPx)

  ctx.restore()
}
