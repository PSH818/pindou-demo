import { TRANSPARENT, type Pattern, type BeadColor, type MaterialItem } from '../types/index.ts'
import type { BoardTile, MakingProgress, PrintOptions } from '../types/making.ts'
import { assertGridDimensions } from './patternLimits.ts'

export function materialItems(pattern: Pattern, colors: BeadColor[]): MaterialItem[] {
  assertGridDimensions(pattern.width, pattern.height)
  if (pattern.grid.length !== pattern.width * pattern.height) throw new Error('图纸格数与尺寸不符')
  const byId = new Map(colors.map(c => [c.id, c])), counts = new Map<number, number>()
  for (const value of pattern.grid) {
    if (value === TRANSPARENT) continue
    const id = pattern.paletteUsed[value]
    if (!byId.has(id)) throw new Error('图纸包含未知色号，无法准确统计用料')
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts].map(([colorId, count]) => ({ ...byId.get(colorId)!, colorId, count }))
    .sort((a, b) => b.count - a.count || a.colorId - b.colorId)
}

/** Exact content identity, not timestamps or a collision-prone short hash. Renaming is harmless. */
export function makingSignature(pattern: Pattern): string {
  return JSON.stringify([pattern.width, pattern.height, pattern.brandId,
    Array.from(pattern.grid, v => v === TRANSPARENT ? -1 : pattern.paletteUsed[v])])
}

export function boardTiles(width: number, height: number, columns: number, rows: number): BoardTile[] {
  assertGridDimensions(width, height)
  if (![columns, rows].every(n => Number.isInteger(n) && n >= 1 && n <= 200)) throw new Error('珠板行列数必须为 1–200 的整数')
  const tiles: BoardTile[] = []
  for (let y = 0, row = 1; y < height; y += rows, row++) {
    for (let x = 0, column = 1; x < width; x += columns, column++) {
      tiles.push({ index: tiles.length, row, column, x, y, width: Math.min(columns, width - x), height: Math.min(rows, height - y) })
    }
  }
  return tiles
}

export function tilePattern(pattern: Pattern, tile: BoardTile): Pattern {
  const grid = new Uint16Array(tile.width * tile.height)
  for (let y = 0; y < tile.height; y++) grid.set(pattern.grid.subarray((tile.y + y) * pattern.width + tile.x, (tile.y + y) * pattern.width + tile.x + tile.width), y * tile.width)
  return { ...pattern, width: tile.width, height: tile.height, grid }
}

export const MATERIALS_PER_PAGE = 28
export function printPlan(pattern: Pattern, colors: BeadColor[], options: PrintOptions) {
  const materials = materialItems(pattern, colors)
  const tiles = options.mode === 'boards' ? boardTiles(pattern.width, pattern.height, options.columns, options.rows) : []
  const materialPages = Math.max(1, Math.ceil(materials.length / MATERIALS_PER_PAGE))
  const pageCount = 1 + tiles.length + materialPages
  if (pageCount > 200) throw new Error('分块超过 200 页，请增大珠板行列数后导出，避免浏览器内存不足')
  return { tiles, materials, materialPages, pageCount }
}

export function assertMakingProgress(value: unknown): asserts value is MakingProgress {
  const p = value as MakingProgress
  if (!p || p.version !== 1 || typeof p.patternId !== 'string' || !p.patternId || typeof p.signature !== 'string' ||
    !Number.isSafeInteger(p.revision) || p.revision < 1 || !Number.isFinite(p.updatedAt) ||
    !Array.isArray(p.completedColorIds) || p.completedColorIds.some(id => !Number.isInteger(id) || id < 0) ||
    new Set(p.completedColorIds).size !== p.completedColorIds.length) throw new Error('制作进度数据损坏，未自动覆盖，请检查本地数据')
}
