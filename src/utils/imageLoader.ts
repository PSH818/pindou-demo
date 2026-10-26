/**
 * 图片加载工具（Web 版）
 * 使用标准 HTMLCanvasElement + Image API，替代 wx.createOffscreenCanvas
 */

import type { BeadColor } from '../types'
import { TRANSPARENT } from '../types'

export interface RawImageBuffer {
  data: ArrayBuffer
  width: number
  height: number
}

export function suggestGridSize(srcW: number, srcH: number): { longSide: number; aspectRatio: number } {
  const maxDim   = Math.max(srcW, srcH)
  const rawSide  = Math.round(Math.sqrt(maxDim) * 4.0)
  const longSide = Math.min(180, Math.max(60, rawSide))
  const evenSide = longSide % 2 === 0 ? longSide : longSide + 1
  return { longSide: evenSide, aspectRatio: srcW / srcH }
}

export function gridDims(longSide: number, aspectRatio: number): { w: number; h: number } {
  if (aspectRatio >= 1) {
    return { w: longSide, h: Math.max(20, Math.round(longSide / aspectRatio)) }
  }
  return { w: Math.max(20, Math.round(longSide * aspectRatio)), h: longSide }
}

export async function loadImageToBuffer(src: string, maxDim = 400): Promise<RawImageBuffer> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const origW = img.naturalWidth
      const origH = img.naturalHeight
      const scale = Math.min(1, maxDim / Math.max(origW, origH))
      const w = Math.max(1, Math.round(origW * scale))
      const h = Math.max(1, Math.round(origH * scale))

      const canvas = document.createElement('canvas')
      canvas.width  = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)
      const imageData = ctx.getImageData(0, 0, w, h)
      resolve({ data: imageData.data.buffer as ArrayBuffer, width: w, height: h })
    }
    img.onerror = () => reject(new Error('图片读取失败，请重试'))
    img.src = src
  })
}

export async function generateThumbnail(
  grid: Uint16Array,
  gridW: number,
  gridH: number,
  paletteUsed: number[],
  colors: BeadColor[],
  size = 192
): Promise<string> {
  const cellSize = Math.max(1, Math.floor(size / Math.max(gridW, gridH)))
  const thumbW   = gridW * cellSize
  const thumbH   = gridH * cellSize

  const canvas = document.createElement('canvas')
  canvas.width  = thumbW
  canvas.height = thumbH
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, thumbW, thumbH)

  const colorMap = new Map<number, [number, number, number]>()
  for (const c of colors) colorMap.set(c.id, c.rgb)

  for (let row = 0; row < gridH; row++) {
    for (let col = 0; col < gridW; col++) {
      const idx = grid[row * gridW + col]
      if (idx === TRANSPARENT) continue
      const colorId = paletteUsed[idx]
      if (colorId === undefined) continue
      const rgb = colorMap.get(colorId)
      if (!rgb) continue
      ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
      ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize)
    }
  }

  return canvas.toDataURL('image/png')
}
