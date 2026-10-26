import { loadImageInfo } from './analyzeImageLoader'
import { createOffscreenCanvas } from './canvasHelper'

export async function removeBackground(imagePath: string, onProgress: (message: string) => void = () => {}): Promise<string> {
  onProgress('检查背景与人物边缘…')
  const image = await loadImageInfo(imagePath)
  const result = await new Promise<ArrayBuffer | null>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/backgroundProcessor.js', import.meta.url), { type: 'module' })
    const finish = (error?: Error, buffer: ArrayBuffer | null = null) => {
      clearTimeout(timer); worker.terminate()
      if (error) reject(error); else resolve(buffer)
    }
    const timer = setTimeout(() => finish(new Error('背景分析超时，请缩小图片后重试')), 30000)
    worker.onerror = () => finish(new Error('背景分析失败，请重试'))
    worker.onmessageerror = () => finish(new Error('抠图结果读取失败，请重试'))
    worker.onmessage = ({ data }) => {
      if (data.type === 'error') finish(new Error(data.error))
      else if (data.type === 'fallback') finish()
      else if (data.type === 'result') finish(undefined, data.rgba)
    }
    try { worker.postMessage(image, [image.imageData]) } catch (error) { finish(error instanceof Error ? error : new Error('无法启动背景分析')) }
  })
  if (result) {
    onProgress('保留人物并清理边缘底色…')
    const canvas = createOffscreenCanvas(image.width, image.height)
    try {
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('无法创建抠图画布')
      ctx.putImageData(new ImageData(new Uint8ClampedArray(result), image.width, image.height), 0, 0)
      return canvas.toDataURL('image/png')
    } finally { canvas.width = 0; canvas.height = 0 }
  }
  // 演示版不打包 AI 抠图模型，复杂背景请先裁剪或换一张纯色背景的图
  throw new Error('背景较复杂，演示版仅支持纯色背景去除')
}
