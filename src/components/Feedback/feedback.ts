/**
 * 全局反馈通道 —— showToast / showModal / showPrompt / showActionSheet / 文件保存面板
 * 由 FeedbackHost（挂载于 main.tsx）订阅并渲染，UI 遵循设计系统 token。
 * 业务代码不直接依赖本模块，统一从 utils/webUtils.ts 导入。
 */

export interface ModalOptions {
  title: string
  content?: string
  confirmText?: string
  cancelText?: string
  showCancel?: boolean
}

export interface ActionSheetItem {
  text: string
  destructive?: boolean
}

export type FeedbackEvent =
  | { kind: 'toast'; msg: string }
  | { kind: 'modal'; opts: ModalOptions; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; title: string; defaultValue: string; resolve: (value: string | null) => void }
  | { kind: 'actionsheet'; items: ActionSheetItem[]; resolve: (index: number) => void }
  | { kind: 'file'; blob: Blob; filename: string }

type Listener = (event: FeedbackEvent) => void

let listener: Listener | null = null
const pending: FeedbackEvent[] = []

/** 仅供 FeedbackHost 挂载/卸载时调用。挂载前触发的事件会排队，挂载后补发。 */
export function _subscribeFeedback(fn: Listener | null): void {
  listener = fn
  if (fn) {
    while (pending.length > 0) fn(pending.shift()!)
  }
}

function emit(event: FeedbackEvent): void {
  if (listener) listener(event)
  else pending.push(event)
}

export function feedbackToast(msg: string): void {
  emit({ kind: 'toast', msg })
}

export function feedbackModal(opts: ModalOptions): Promise<boolean> {
  return new Promise(resolve => emit({ kind: 'modal', opts, resolve }))
}

export function feedbackPrompt(title: string, defaultValue = ''): Promise<string | null> {
  return new Promise(resolve => emit({ kind: 'prompt', title, defaultValue, resolve }))
}

/** 手机 / 内置浏览器的导出出口：弹出保存面板（预览、分享、下载） */
export function feedbackFile(blob: Blob, filename: string): void {
  emit({ kind: 'file', blob, filename })
}

/** 返回选中下标；-1 表示取消 */
export function feedbackActionSheet(items: (string | ActionSheetItem)[]): Promise<number> {
  const normalized = items.map(i => (typeof i === 'string' ? { text: i } : i))
  return new Promise(resolve => emit({ kind: 'actionsheet', items: normalized, resolve }))
}
