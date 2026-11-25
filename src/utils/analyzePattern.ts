/**
 * analyzePattern.ts — 图纸识别主线程辅助
 * 负责：
 *   1. 从 ObjectURL 读取 ImageData（给 Worker 用）
 *   2. 由 Worker 结果构建 Pattern 对象
 *   3. 生成 64×64 缩略图
 */

import type { Pattern, BrandId, BeadColor } from '../types'
import { countByColorId } from './patternOps'
import { generateThumbnail } from './imageLoader'
import { downloadBlob } from './webUtils'

export { loadImageInfo, type ImageInfo } from './analyzeImageLoader'

// ─── 构建 Pattern ─────────────────────────────────────────────

/**
 * 由 Worker 分析结果构建完整 Pattern 对象（含缩略图）。
 */
export async function buildPattern(
  grid:        Uint16Array,
  paletteUsed: number[],
  cols:        number,
  rows:        number,
  brandId:     BrandId,
  allColors:   BeadColor[],
  name:        string,
): Promise<Pattern> {
  const thumbnail = await generateThumbnail(grid, cols, rows, paletteUsed, allColors)
  const now = Date.now()

  return {
    id:          `analyze_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    width:       cols,
    height:      rows,
    brandId,
    paletteUsed,
    grid:        grid.slice(),  // 防止 transfer 后被清空
    thumbnail,
    createdAt:   now,
    updatedAt:   now,
  }
}

// ─── 用料清单渲染（给 ColorTable 用）────────────────────────

export interface ColorEntry {
  colorId:  number
  code:     string
  name:     string
  rgb:      [number, number, number]
  count:    number
  percent:  number  // 0-100
}

/**
 * 从 grid + paletteUsed 计算每种颜色的用量，降序排列。
 */
export function calcColorEntries(
  grid:        Uint16Array,
  paletteUsed: number[],
  allColors:   BeadColor[],
): ColorEntry[] {
  const countMap = countByColorId(grid, paletteUsed)

  const total = Array.from(countMap.values()).reduce((s, v) => s + v, 0)
  const colorById = new Map(allColors.map(c => [c.id, c]))

  return Array.from(countMap.entries())
    .map(([colorId, count]) => {
      const c = colorById.get(colorId)!
      return {
        colorId,
        code:    c.code,
        name:    c.name,
        rgb:     c.rgb,
        count,
        percent: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
      }
    })
    .sort((a, b) => b.count - a.count)
}

// ─── CSV 导出 ─────────────────────────────────────────────────

export function exportColorEntriesCSV(entries: ColorEntry[], patternName: string): void {
  const rows = [
    ['色号', '颜色名称', '数量（粒）', '占比（%）', 'R', 'G', 'B'],
    ...entries.map(e => [
      e.code,
      e.name,
      String(e.count),
      String(e.percent),
      String(e.rgb[0]),
      String(e.rgb[1]),
      String(e.rgb[2]),
    ]),
  ]
  const total = entries.reduce((s, e) => s + e.count, 0)
  rows.push(['合计', '', String(total), total > 0 ? '100' : '0', '', '', ''])

  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  downloadBlob(blob, `${patternName}_用料清单.csv`)
}
