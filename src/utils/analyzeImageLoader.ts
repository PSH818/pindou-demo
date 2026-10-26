import { createOffscreenCanvas } from './canvasHelper.ts'

export interface ImageInfo {
  imageData: ArrayBuffer
  width: number
  height: number
}

/** Full-resolution chart read; errors, timeouts and cancellation always settle. */
export function loadImageInfo(url: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ImageInfo> {
  return new Promise((resolve, reject) => {
    const { signal, timeoutMs = 30_000 } = options
    const cancelled = () => new DOMException('图片读取已取消', 'AbortError')
    if (signal?.aborted) { reject(cancelled()); return }
    const img = new Image()
    let canvas: HTMLCanvasElement | null = null
    let settled = false
    const finish = (error?: Error, result?: ImageInfo) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      img.onload = null
      img.onerror = null
      img.removeAttribute('src')
      if (canvas) { canvas.width = 0; canvas.height = 0; canvas = null }
      if (error) reject(error)
      else resolve(result!)
    }
    const onAbort = () => finish(cancelled())
    const timer = setTimeout(() => finish(new Error('图片读取超时，请重新选择图片后重试')), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    img.onload = () => {
      if (settled) return
      try {
        const width = img.naturalWidth, height = img.naturalHeight
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
          throw new Error('图片尺寸无效，请重新选择图片')
        }
        // Guard allocation before creating a full-size canvas. Never silently resize charts.
        if (width > 16_384 || height > 16_384 || width * height > 32_000_000) {
          throw new Error('图片尺寸过大，请先缩小到单边不超过 16384 像素、总像素不超过 3200 万后重试')
        }
        canvas = createOffscreenCanvas(width, height)
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('无法创建图片读取画布，请重试或更换浏览器')
        ctx.drawImage(img, 0, 0)
        const { data } = ctx.getImageData(0, 0, width, height)
        // ImageData already owns an independent buffer; do not allocate another copy.
        finish(undefined, { imageData: data.buffer as ArrayBuffer, width, height })
      } catch (error) {
        const cause = error instanceof Error ? error.message : '浏览器无法读取像素'
        finish(new Error(`图片读取失败：${cause}`))
      }
    }
    img.onerror = () => finish(new Error('图片加载失败，文件可能已损坏或无法访问，请重新选择图片'))
    try {
      img.crossOrigin = 'anonymous'
      img.src = url
    } catch (error) {
      finish(new Error(`图片加载失败：${error instanceof Error ? error.message : '无法打开图片'}`))
    }
  })
}
