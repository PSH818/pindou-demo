/**
 * Local PDF export. Pages are rendered one at a time; no editable grid is modified.
 * Canvas text supports the current Chinese labels without loading remote fonts.
 */
import jsPDF from 'jspdf'
import type { Pattern, BeadColor } from '../types'
import type { PrintOptions } from '../types/making'
import { renderFull } from '../components/PatternCanvas/renderer'
import { createOffscreenCanvas } from './canvasHelper'
import { printPlan, tilePattern, MATERIALS_PER_PAGE } from './making'

const W = 1240, H = 1754, PAD = 70
const BG = '#FFFBF7', TEXT = '#2C1810', DIM = '#9B7E72', BORDER = '#EDD0B8', ACCENT = '#F0874E'
export const DEFAULT_PRINT_OPTIONS: PrintOptions = { mode: 'whole', columns: 29, rows: 29 }

function page() {
  const canvas = createOffscreenCanvas(W, H), ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器无法创建打印画布')
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H)
  return { canvas, ctx }
}
function line(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size = 24, width = W - PAD * 2) {
  ctx.font = `${size}px sans-serif`; ctx.fillStyle = TEXT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  let text = value.replace(/\s+/g, ' ')
  while (text.length && ctx.measureText(text).width > width) text = text.slice(0, -1)
  ctx.fillText(text === value.replace(/\s+/g, ' ') ? text : text.slice(0, -1) + '…', x, y)
}
function footer(ctx: CanvasRenderingContext2D, n: number, total: number) {
  ctx.fillStyle = BORDER; ctx.fillRect(PAD, H - 94, W - PAD * 2, 1)
  line(ctx, `第 ${n} / ${total} 页 · 拼豆图纸 · 透明格不放珠`, PAD, H - 55, 22)
}
function drawGrid(ctx: CanvasRenderingContext2D, pattern: Pattern, colors: BeadColor[], cell: number, x: number, y: number, originX = 0, originY = 0) {
  // renderFull clears its canvas: draw into a separate surface, never erase the page header.
  const grid = createOffscreenCanvas(pattern.width * cell, pattern.height * cell), g = grid.getContext('2d')
  if (!g) throw new Error('无法绘制图纸')
  renderFull(g, grid.width, grid.height, pattern, colors, { scale: cell, offsetX: 0, offsetY: 0, showGrid: true, showColorCode: cell >= 18, circular: false, highlightColorIdx: null })
  ctx.drawImage(grid, x, y); grid.width = grid.height = 0
  ctx.strokeStyle = '#bd6959'; ctx.lineWidth = 1.3
  for (let i = 0; i <= pattern.width; i++) if ((originX + i) % 5 === 0) { ctx.beginPath(); ctx.moveTo(x + i * cell, y); ctx.lineTo(x + i * cell, y + pattern.height * cell); ctx.stroke() }
  for (let i = 0; i <= pattern.height; i++) if ((originY + i) % 5 === 0) { ctx.beginPath(); ctx.moveTo(x, y + i * cell); ctx.lineTo(x + pattern.width * cell, y + i * cell); ctx.stroke() }
  ctx.font = `${Math.min(18, Math.max(9, cell * .48))}px sans-serif`; ctx.fillStyle = TEXT; ctx.textBaseline = 'middle'
  for (let i = 0; i < pattern.width; i++) if (cell >= 22 || i === 0 || i === pattern.width - 1 || (originX + i + 1) % 5 === 0) { ctx.textAlign = 'center'; ctx.fillText(String(originX + i + 1), x + (i + .5) * cell, y - 18) }
  for (let i = 0; i < pattern.height; i++) if (cell >= 22 || i === 0 || i === pattern.height - 1 || (originY + i + 1) % 5 === 0) { ctx.textAlign = 'right'; ctx.fillText(String(originY + i + 1), x - 12, y + (i + .5) * cell) }
}

export function* renderPDFPages(pattern: Pattern, colors: BeadColor[], options: PrintOptions = DEFAULT_PRINT_OPTIONS): Generator<HTMLCanvasElement> {
  const plan = printPlan(pattern, colors, options), total = plan.materials.reduce((s, c) => s + c.count, 0)
  let pageNo = 1
  {
    const { canvas, ctx } = page()
    line(ctx, pattern.name, PAD, 70, 34)
    line(ctx, `${pattern.width} × ${pattern.height} 格 · ${total} 粒 · ${plan.materials.length} 色`, PAD, 120)
    line(ctx, options.mode === 'boards' ? `分块总览：${Math.ceil(pattern.width / options.columns)} 列 × ${Math.ceil(pattern.height / options.rows)} 行珠板，每板 ${options.columns} × ${options.rows} 格` : '完整图纸 · 用料清单在后续页', PAD, 163, 22)
    const cell = Math.min(40, Math.floor(Math.min(1050 / pattern.width, 1320 / pattern.height)))
    const x = (W - pattern.width * cell) / 2, y = 230
    drawGrid(ctx, pattern, colors, cell, x, y)
    if (options.mode === 'boards') for (const t of plan.tiles) {
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 3; ctx.strokeRect(x + t.x * cell, y + t.y * cell, t.width * cell, t.height * cell)
      if (t.width * cell >= 65 && t.height * cell >= 35) {
        ctx.fillStyle = BG; ctx.fillRect(x + t.x * cell + 2, y + t.y * cell + 2, Math.min(118, t.width * cell - 4), 30)
        line(ctx, `${t.row}-${t.column} / P${t.index + 2}`, x + t.x * cell + 6, y + t.y * cell + 18, 18, Math.min(110, t.width * cell - 10))
      }
    }
    line(ctx, '按原图方向从左到右、从上到下拼接。页面为阅读缩放，不是实物 1:1。', PAD, 1605, 20)
    footer(ctx, pageNo++, plan.pageCount); yield canvas
  }
  for (const tile of plan.tiles) {
    const { canvas, ctx } = page(), part = tilePattern(pattern, tile)
    line(ctx, `珠板 ${tile.row}-${tile.column} · ${pattern.name}`, PAD, 70, 32)
    line(ctx, `原图第 ${tile.y + 1}–${tile.y + tile.height} 行 / 第 ${tile.x + 1}–${tile.x + tile.width} 列`, PAD, 120, 25)
    line(ctx, `本块 ${tile.width} × ${tile.height} 格 · 珠板规格 ${options.columns} × ${options.rows} 格 · 无重叠格`, PAD, 162, 22)
    const cell = Math.max(1, Math.min(40, Math.floor(Math.min(1050 / Math.min(options.columns, pattern.width), 1300 / Math.min(options.rows, pattern.height)))))
    drawGrid(ctx, part, colors, cell, 120, 230, tile.x, tile.y)
    const neighbors = (r: number, c: number) => plan.tiles.find(t => t.row === r && t.column === c) ? `${r}-${c}` : '外边缘'
    line(ctx, `上：${neighbors(tile.row - 1, tile.column)}   下：${neighbors(tile.row + 1, tile.column)}   左：${neighbors(tile.row, tile.column - 1)}   右：${neighbors(tile.row, tile.column + 1)}`, PAD, 1570, 21)
    line(ctx, '保持原方向拼接，行列编号是原图坐标；余下珠板区域不放珠。非实物 1:1。', PAD, 1610, 20)
    footer(ctx, pageNo++, plan.pageCount); yield canvas
  }
  for (let p = 0; p < plan.materialPages; p++) {
    const { canvas, ctx } = page()
    line(ctx, `用料清单 ${p + 1} / ${plan.materialPages}`, PAD, 70, 34)
    line(ctx, `${pattern.name} · ${pattern.brandId.toUpperCase()} · 全图 ${total} 粒 / ${plan.materials.length} 色`, PAD, 120, 24)
    line(ctx, '实际珠数，不含透明格；不含额外损耗。所有颜色均列出。', PAD, 164, 22)
    line(ctx, '色号', 130, 220); line(ctx, '用量（粒）', 690, 220); line(ctx, '占全图', 970, 220)
    const items = plan.materials.slice(p * MATERIALS_PER_PAGE, (p + 1) * MATERIALS_PER_PAGE)
    items.forEach((item, i) => {
      const y = 270 + i * 46
      ctx.fillStyle = `rgb(${item.rgb.join(',')})`; ctx.fillRect(PAD, y - 14, 28, 28)
      ctx.strokeStyle = BORDER; ctx.strokeRect(PAD, y - 14, 28, 28)
      line(ctx, item.code, 130, y, 25, 500)
      line(ctx, String(item.count), 690, y, 25, 200)
      line(ctx, `${(item.count / total * 100).toFixed(1)}%`, 970, y, 23, 180)
    })
    if (!items.length) line(ctx, '图纸全透明，没有需要准备的珠子。', PAD, 280)
    line(ctx, `本页合计 ${items.reduce((s, i) => s + i.count, 0)} 粒 · 全图合计 ${total} 粒`, PAD, 1600, 24)
    footer(ctx, pageNo++, plan.pageCount); yield canvas
  }
}

export async function buildPatternPDF(pattern: Pattern, colors: BeadColor[], options: PrintOptions = DEFAULT_PRINT_OPTIONS, progress?: (current: number, total: number) => void): Promise<Blob> {
  const plan = printPlan(pattern, colors, options)
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true })
  let n = 0
  for (const canvas of renderPDFPages(pattern, colors, options)) {
    try {
      if (n) pdf.addPage()
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297)
    } finally { canvas.width = canvas.height = 0 }
    progress?.(++n, plan.pageCount)
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  return new Blob([pdf.output('arraybuffer')], { type: 'application/pdf' })
}

export async function exportPatternToPDF(pattern: Pattern, colors: BeadColor[], options: PrintOptions = DEFAULT_PRINT_OPTIONS, progress?: (current: number, total: number) => void): Promise<void> {
  const blob = await buildPatternPDF(pattern, colors, options, progress), url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${pattern.name.replace(/[\\/:*?"<>|]/g, '_') || '拼豆图纸'}${options.mode === 'boards' ? '-分块' : ''}.pdf`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
