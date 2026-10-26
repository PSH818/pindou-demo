import { TRANSPARENT, type BeadColor, type ConvertParams, type ConversionAlgorithm, type WorkerResponse } from '../types/index.ts'
import { createOffscreenCanvas } from './canvasHelper'

export { ALGORITHM_LABELS } from './conversionSettings'

export interface ConversionPreview {
  algorithm: ConversionAlgorithm
  grid: Uint16Array
  paletteUsed: number[]
  elapsedMs: number
}

/** Independent preview execution: no store or IndexedDB writes. */
export function runPreview(
  image: { data: ArrayBuffer; width: number; height: number },
  params: ConvertParams,
  palette: BeadColor[],
  algorithm: ConversionAlgorithm,
  signal: AbortSignal,
  onProgress: (value: number) => void,
): Promise<ConversionPreview> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('已取消', 'AbortError')); return }
    const start = performance.now()
    const worker = algorithm === 'cartoon-v1'
      ? new Worker(new URL('../workers/cartoonProcessor.js', import.meta.url), { type: 'module' })
      : algorithm === 'perceptual-v1'
      ? new Worker(new URL('../workers/faithfulProcessor.js', import.meta.url), { type: 'module' })
      : new Worker(new URL('../workers/imageProcessor.js', import.meta.url), { type: 'module' })
    const cleanup = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      worker.terminate()
    }
    const fail = (error: Error) => { cleanup(); reject(error) }
    const abort = () => fail(new DOMException('已取消', 'AbortError'))
    const timer = setTimeout(() => fail(new Error('对比计算超时，请缩小图纸后重试')), 120_000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = () => fail(new Error('对比计算失败，请重试'))
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.type === 'progress') { onProgress(data.progress ?? 0); return }
      if (data.type === 'error') { fail(new Error(data.error ?? '转换失败')); return }
      if (data.type !== 'result') return
      const validIds = new Set(palette.map(color => color.id))
      if (!(data.grid instanceof ArrayBuffer) || data.grid.byteLength !== params.width * params.height * 2 ||
          !Array.isArray(data.paletteUsed) || data.paletteUsed.some(id => !validIds.has(id))) {
        fail(new Error('对比返回的图纸数据无效')); return
      }
      const grid = new Uint16Array(data.grid)
      if (grid.some(index => index !== TRANSPARENT && index >= data.paletteUsed!.length)) {
        fail(new Error('对比返回的色号索引无效')); return
      }
      cleanup()
      resolve({ algorithm, grid, paletteUsed: data.paletteUsed, elapsedMs: performance.now() - start })
    }
    // Each worker receives its own copy of the identical preprocessed bytes.
    const buffer = image.data.slice(0)
    try {
      worker.postMessage({ type: 'convert', imageData: buffer, imageWidth: image.width,
        imageHeight: image.height, params: { ...params, algorithm }, palette }, [buffer])
    } catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
  })
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
