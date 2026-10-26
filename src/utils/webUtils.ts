/**
 * Web 端对小程序 API 的替代实现
 * showToast / showModal / showPrompt / showActionSheet / pickImageFile / getImageDimensions
 *
 * 反馈类 API 统一委托给 components/Feedback（React 渲染，遵循设计系统），
 * 签名与旧实现保持一致，调用方无需改动。
 */

import {
  feedbackToast,
  feedbackModal,
  feedbackPrompt,
  feedbackActionSheet,
  feedbackFile,
  type ModalOptions,
  type ActionSheetItem,
} from '../components/Feedback/feedback'

export type { ModalOptions, ActionSheetItem }

export function showToast(msg: string, _type?: string): void {
  feedbackToast(msg)
}

export function showModal(opts: ModalOptions): Promise<boolean> {
  return feedbackModal(opts)
}

export function showPrompt(title: string, defaultValue = ''): Promise<string | null> {
  return feedbackPrompt(title, defaultValue)
}

/** 底部动作面板，返回选中下标（-1 = 取消） */
export function showActionSheet(items: (string | ActionSheetItem)[]): Promise<number> {
  return feedbackActionSheet(items)
}

// ─── Image picker ────────────────────────────────────────────

export function pickImageFile(): Promise<string | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.style.display = 'none'
    document.body.appendChild(input)
    input.onchange = () => {
      const file = input.files?.[0]
      document.body.removeChild(input)
      if (!file) { resolve(null); return }
      resolve(URL.createObjectURL(file))
    }
    input.addEventListener('cancel', () => {
      document.body.removeChild(input)
      resolve(null)
    })
    input.click()
  })
}

export function revokeObjectUrl(url: string | null | undefined): void {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
}

// ─── Image dimensions ────────────────────────────────────────

export function getImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload  = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

// ─── Environment ─────────────────────────────────────────────

/** 微信 / QQ 内置浏览器：不支持 a.download，也没有系统分享 */
export function isInAppBrowser(): boolean {
  return /MicroMessenger|QQ\//i.test(navigator.userAgent)
}

export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches
}

export function isIOS(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
}

// ─── Image size guard ────────────────────────────────────────

/** 转换前最长边上限。转换本身会再缩到 400，这里只为躲开 iOS Safari 单画布约 1677 万像素的上限 */
export const MAX_SOURCE_SIDE = 2048

/**
 * 手机原图（常见 1200 万～4800 万像素）先等比缩到最长边 MAX_SOURCE_SIDE，再进预处理。
 * 不超限时原样返回；缩放后回收原 blob URL。
 */
export async function limitImageSize(url: string, maxSide = MAX_SOURCE_SIDE): Promise<string> {
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload  = () => resolve()
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = url
  })
  const scale = maxSide / Math.max(img.naturalWidth, img.naturalHeight)
  if (scale >= 1) return url
  const canvas = document.createElement('canvas')
  canvas.width  = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) return url
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    // 照片转 JPEG 省内存；PNG / WebP / GIF 可能带透明，保持 PNG
    const sourceType = (await (await fetch(url)).blob()).type
    const type = /png|webp|gif/.test(sourceType) ? 'image/png' : 'image/jpeg'
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, 0.92))
    if (!blob) return url
    revokeObjectUrl(url)
    return URL.createObjectURL(blob)
  } finally {
    canvas.width = 0; canvas.height = 0
  }
}

// ─── Download helpers ────────────────────────────────────────

/**
 * 统一导出出口。桌面直接下载；手机和内置浏览器弹出保存面板，
 * 因为 a.download 在微信里无效，在 iOS 上只会存进「文件」而不是相册。
 */
export function downloadBlob(blob: Blob, filename: string): void {
  if (isTouchDevice() || isInAppBrowser()) { feedbackFile(blob, filename); return }
  directDownload(blob, filename)
}

export function directDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
