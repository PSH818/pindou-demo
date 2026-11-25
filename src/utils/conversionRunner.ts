/**
 * 图片转图纸的唯一 Worker 调度入口。
 * 正式转换（usePattern）和算法对比（algorithmComparison）都走这里：
 * 选 Worker、收发消息、校验结果、取消、超时只写一遍。
 */
import { TRANSPARENT, type BeadColor, type ConvertParams, type WorkerRequest, type WorkerResponse } from '../types/index.ts'

export interface ConversionOutput {
  grid: Uint16Array
  paletteUsed: number[]
}

export interface RawImage {
  data: ArrayBuffer
  width: number
  height: number
}

function createWorker(algorithm: ConvertParams['algorithm']): Worker {
  // 保真模式与轮廓增强共用一个入口；经典模式是独立的冻结实现
  return !algorithm || algorithm === 'legacy'
    ? new Worker(new URL('../workers/imageProcessor.js', import.meta.url), { type: 'module' })
    : new Worker(new URL('../workers/faithfulProcessor.js', import.meta.url), { type: 'module' })
}

/** 校验 Worker 返回的图纸：格数、色号、下标必须全部合法，否则返回 null。 */
export function parseConversionResult(
  response: Pick<WorkerResponse, 'grid' | 'paletteUsed'>,
  width: number,
  height: number,
  palette: BeadColor[],
): ConversionOutput | null {
  const { grid: buffer, paletteUsed } = response
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== width * height * 2) return null
  if (!Array.isArray(paletteUsed)) return null
  const validIds = new Set(palette.map(color => color.id))
  if (paletteUsed.some(id => !validIds.has(id))) return null
  const grid = new Uint16Array(buffer)
  for (const index of grid) {
    if (index !== TRANSPARENT && index >= paletteUsed.length) return null
  }
  return { grid, paletteUsed }
}

/**
 * 在 Worker 里跑一次转换。image.data 会被转移给 Worker，调用后不可再用；
 * 同一份像素要跑多次时，每次传入一份拷贝。
 * 取消时以 AbortError 拒绝。不读写 store 和 IndexedDB。
 */
export function runConversion(
  image: RawImage,
  params: ConvertParams,
  palette: BeadColor[],
  options: { signal?: AbortSignal; onProgress?: (percent: number) => void; timeoutMs?: number } = {},
): Promise<ConversionOutput> {
  const { signal, onProgress, timeoutMs } = options
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('已取消', 'AbortError')); return }
    const worker = createWorker(params.algorithm)
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      worker.terminate()
    }
    const fail = (error: Error) => { cleanup(); reject(error) }
    const abort = () => fail(new DOMException('已取消', 'AbortError'))
    const timer = timeoutMs ? setTimeout(() => fail(new Error('转换超时，请缩小图纸后重试')), timeoutMs) : undefined
    signal?.addEventListener('abort', abort, { once: true })

    worker.onerror = () => fail(new Error('转换进程意外退出，请重试'))
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.type === 'progress') { onProgress?.(data.progress ?? 0); return }
      if (data.type === 'error') { fail(new Error(data.error ?? '转换失败')); return }
      if (data.type !== 'result') return
      const output = parseConversionResult(data, params.width, params.height, palette)
      if (!output) { fail(new Error('转换结果无效，请重试')); return }
      cleanup()
      resolve(output)
    }

    const request: WorkerRequest = {
      type: 'convert', imageData: image.data, imageWidth: image.width, imageHeight: image.height, params, palette,
    }
    try { worker.postMessage(request, [image.data]) }
    catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
  })
}
