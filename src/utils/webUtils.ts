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

// ─── Download helpers ────────────────────────────────────────

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
