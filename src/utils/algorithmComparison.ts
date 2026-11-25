import { TRANSPARENT, type BeadColor, type ConvertParams, type ConversionAlgorithm } from '../types/index.ts'
import { createOffscreenCanvas } from './canvasHelper'
import { runConversion, type RawImage } from './conversionRunner'

export { ALGORITHM_LABELS } from './conversionSettings'

export interface ConversionPreview {
  algorithm: ConversionAlgorithm
  grid: Uint16Array
  paletteUsed: number[]
  elapsedMs: number
}

/** 对比用的独立预览：只跑转换并计时，不写 store 和 IndexedDB。 */
export async function runPreview(
  image: RawImage,
  params: ConvertParams,
  palette: BeadColor[],
  algorithm: ConversionAlgorithm,
  signal: AbortSignal,
  onProgress: (value: number) => void,
): Promise<ConversionPreview> {
  const start = performance.now()
  // 两种算法各拿一份相同的像素拷贝（缓冲区会被转移给 Worker）
  const result = await runConversion({ ...image, data: image.data.slice(0) }, { ...params, algorithm }, palette,
    { signal, onProgress, timeoutMs: 120_000 })
  return { algorithm, ...result, elapsedMs: performance.now() - start }
}

export function previewImage(preview: ConversionPreview, w: number, h: number, colors: BeadColor[]): string {
  const canvas = createOffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法绘制对比图纸')
  const byId = new Map(colors.map(c => [c.id, c]))
  preview.grid.forEach((index, i) => {
    if (index === TRANSPARENT) return
    const color = byId.get(preview.paletteUsed[index])!
    ctx.fillStyle = `rgb(${color.rgb.join(',')})`
    ctx.fillRect(i % w, Math.floor(i / w), 1, 1)
  })
  return canvas.toDataURL('image/png')
}

export function previewStats(grid: Uint16Array, w: number, h: number) {
  const used = new Set<number>()
  let beads = 0, isolated = 0
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === TRANSPARENT) continue
    beads++
    used.add(grid[i])
    const x = i % w, y = Math.floor(i / w)
    const adjacent = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]
    if (!adjacent.some(j => j >= 0 && grid[j] === grid[i])) isolated++
  }
  return { beads, colors: used.size, isolated }
}
