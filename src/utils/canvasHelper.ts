/**
 * Canvas 工具（Web 版）
 * 不再需要 createSelectorQuery，直接通过 ref 操作 HTMLCanvasElement
 */

export interface CanvasContext {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  width: number
  height: number
}

export function getCanvasFromRef(ref: React.RefObject<HTMLCanvasElement>): CanvasContext | null {
  const canvas = ref.current
  if (!canvas) return null
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  return { canvas, ctx, width: canvas.offsetWidth, height: canvas.offsetHeight }
}

/** 离屏 Canvas 工具，供 export.ts / exportPDF.ts 使用 */
export function createOffscreenCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width  = w
  canvas.height = h
  return canvas
}

export function canvasToBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality = 1): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('toBlob 失败'))
    }, type, quality)
  })
}
