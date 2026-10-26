/**
 * 品牌色板加载与用料清单计算
 */

import {
  TRANSPARENT,
  type BrandId,
  type BeadBrand,
  type BeadColor,
  type ColorSystem,
  type Pattern,
  type MaterialItem,
} from '../types/index.ts'

export interface BrandOption {
  id: BrandId
  name: string
  description: string
  beadSizeMm: number
  colorSystem: ColorSystem | null
}

/**
 * 可选品牌的唯一元数据源。国产五品牌共享同一套上游 RGB 基准色，
 * 仅按各自色号投影；Artkal C 使用独立实测色板。
 */
export const BRAND_OPTIONS: readonly BrandOption[] = [
  { id: 'mard',     name: 'MARD',          description: '291 色 · 2.6 mm', beadSizeMm: 2.6, colorSystem: 'MARD' },
  { id: 'coco',     name: 'COCO',          description: '291 色 · 2.6 mm', beadSizeMm: 2.6, colorSystem: 'COCO' },
  { id: 'manman',   name: '漫漫',          description: '290 色 · 2.6 mm', beadSizeMm: 2.6, colorSystem: '漫漫' },
  { id: 'panpan',   name: '盼盼',          description: '291 色 · 2.6 mm', beadSizeMm: 2.6, colorSystem: '盼盼' },
  { id: 'mixiaowo', name: '咪小窝',        description: '291 色 · 2.6 mm', beadSizeMm: 2.6, colorSystem: '咪小窝' },
  { id: 'artkal_c', name: 'Artkal Mini C', description: '108 色 · 2.6 mm', beadSizeMm: 2.6, colorSystem: null },
] as const

const BRAND_BY_ID = new Map(BRAND_OPTIONS.map(option => [option.id, option]))

export function getBrandOption(brandId: BrandId): BrandOption {
  const option = BRAND_BY_ID.get(brandId)
  if (!option) throw new Error(`不支持的珠子品牌：${brandId}`)
  return option
}

export function getColorSystemForBrand(brandId: BrandId): ColorSystem | null {
  return getBrandOption(brandId).colorSystem
}

/** 将共享基准色板投影为指定品牌色号；"-" 表示该品牌没有对应色。 */
export function deriveBrandColors(colors: readonly BeadColor[], colorSystem: ColorSystem): BeadColor[] {
  return colors.flatMap(color => {
    const code = color.brandCodes?.[colorSystem]
    if (!code || code === '-') return []
    return [{ ...color, code, name: code }]
  })
}

// 懒加载色板数据，避免全部预加载
const _cache = new Map<BrandId, BeadBrand>()

export async function loadBrand(brandId: BrandId): Promise<BeadBrand> {
  if (_cache.has(brandId)) return _cache.get(brandId)!

  const option = getBrandOption(brandId)
  const module = brandId === 'artkal_c'
    ? await import('../data/artkal_c.json')
    : await import('../data/mard.json')
  const sourceColors = module.default as unknown as BeadColor[]
  const colors = option.colorSystem
    ? deriveBrandColors(sourceColors, option.colorSystem)
    : sourceColors
  const brand: BeadBrand = {
    id: brandId,
    name: option.name,
    beadSizeMm: option.beadSizeMm,
    colorSystem: option.colorSystem,
    colors,
  }
  _cache.set(brandId, brand)
  return brand
}

/** 根据图纸计算用料清单（按用量降序） */
export function calcMaterials(pattern: Pattern, allColors: BeadColor[]): MaterialItem[] {
  const countMap = new Map<number, number>()

  for (let i = 0; i < pattern.grid.length; i++) {
    const idx = pattern.grid[i]
    if (idx === TRANSPARENT) continue
    const colorId = pattern.paletteUsed[idx]
    countMap.set(colorId, (countMap.get(colorId) ?? 0) + 1)
  }

  const colorById = new Map(allColors.map(c => [c.id, c]))

  return Array.from(countMap.entries())
    .map(([colorId, count]) => {
      const color = colorById.get(colorId)!
      return { colorId, code: color.code, name: color.name, rgb: color.rgb, count }
    })
    .sort((a, b) => b.count - a.count)
}

/** 生成可复制的购物清单文本 */
export function formatMaterialText(items: MaterialItem[], patternName: string): string {
  const lines = [`【${patternName}】用料清单`, '']
  for (const item of items) {
    lines.push(`${item.code} ${item.name}  ×${item.count}粒`)
  }
  const total = items.reduce((s, i) => s + i.count, 0)
  lines.push('', `合计：${total} 粒`)
  return lines.join('\n')
}
