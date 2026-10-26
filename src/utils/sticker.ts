import { TRANSPARENT, type Pattern, type BeadColor } from '../types/index.ts'
import type { Sticker } from '../data/stickers.ts'

export interface StickerPixels { width: number; height: number; cells: number[] }

export function transformSticker(sticker: Sticker, turns = 0, flipX = false, flipY = false, size = 1): StickerPixels {
  if (!Number.isInteger(turns) || !Number.isInteger(size) || size < 1 || size > 3) throw new Error('贴纸变换无效')
  let width = sticker.rows[0]?.length ?? 0, height = sticker.rows.length
  if (!width || width > 64 || !height || height > 64 || sticker.rows.some(r => r.length !== width)) throw new Error('贴纸尺寸无效')
  let cells = sticker.rows.flatMap(r => [...r].map(c => {
    if (c === '.') return TRANSPARENT
    const slot = Number(c)
    if (!/^\d$/.test(c) || slot >= sticker.colors.length) throw new Error('贴纸色槽无效')
    return slot
  }))
  for (let n = 0; n < ((turns % 4) + 4) % 4; n++) {
    const next = new Array<number>(cells.length)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) next[x * height + height - 1 - y] = cells[y * width + x]
    cells = next
    ;[width, height] = [height, width]
  }
  const result = new Array<number>(width * height * size * size)
  for (let y = 0; y < height * size; y++) for (let x = 0; x < width * size; x++) {
    const sx = Math.floor(x / size), sy = Math.floor(y / size)
    result[y * width * size + x] = cells[(flipY ? height - 1 - sy : sy) * width + (flipX ? width - 1 - sx : sx)]
  }
  return { width: width * size, height: height * size, cells: result }
}

/** Only chooses initial sticker swatches, unrelated to image conversion algorithms. */
export function stickerDefaults(sticker: Sticker, palette: BeadColor[]): number[] {
  if (!palette.length) throw new Error('当前品牌色板为空')
  return sticker.colors.map(rgb => palette.reduce((best, c) => {
    const distance = (v: BeadColor) => v.rgb.reduce((sum, n, i) => sum + (n - rgb[i]) ** 2, 0)
    return distance(c) < distance(best) ? c : best
  }).id)
}

/** Pure preview / composition; never changes the source or writes to storage. */
export function placeSticker(pattern: Pattern, sticker: StickerPixels, colorIds: number[], x: number, y: number) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error('位置必须是整数格')
  if (sticker.cells.length !== sticker.width * sticker.height) throw new Error('贴纸数据不完整')
  const grid = pattern.grid.slice(), paletteUsed = [...pattern.paletteUsed]
  let overlap = 0, outside = 0, changed = 0, beads = 0
  for (let i = 0; i < sticker.cells.length; i++) {
    const slot = sticker.cells[i]
    if (slot === TRANSPARENT) continue
    const id = colorIds[slot]
    if (!Number.isSafeInteger(id) || id < 0) throw new Error('请选择有效的贴纸颜色')
    beads++
    const px = x + i % sticker.width, py = y + Math.floor(i / sticker.width)
    if (px < 0 || py < 0 || px >= pattern.width || py >= pattern.height) { outside++; continue }
    const pos = py * pattern.width + px
    if (grid[pos] !== TRANSPARENT) overlap++
    let index = paletteUsed.indexOf(id)
    if (index < 0) { index = paletteUsed.length; paletteUsed.push(id) }
    if (grid[pos] !== index) changed++
    grid[pos] = index
  }
  return { grid, paletteUsed, overlap, outside, changed, beads }
}
