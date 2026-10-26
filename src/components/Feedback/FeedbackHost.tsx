import { useEffect, useRef, useState } from 'react'
import FileSheet from './FileSheet'
import {
  _subscribeFeedback,
  type ActionSheetItem,
  type FeedbackEvent,
  type ModalOptions,
} from './feedback'
import './index.scss'

type DialogState =
  | { kind: 'modal'; opts: ModalOptions; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; title: string; defaultValue: string; resolve: (value: string | null) => void }
  | { kind: 'actionsheet'; items: ActionSheetItem[]; resolve: (index: number) => void }

/** 各弹层「取消」时的结算值 */
function cancelValue(d: DialogState): boolean | null | number {
  if (d.kind === 'modal') return d.opts.showCancel === false ? true : false
  if (d.kind === 'prompt') return null
  return -1
}

export default function FeedbackHost() {
  const [toast, setToast]     = useState<{ msg: string; seq: number } | null>(null)
  const [dialog, setDialog]   = useState<DialogState | null>(null)
  const [promptValue, setPromptValue] = useState('')
  const [file, setFile]       = useState<{ blob: Blob; filename: string } | null>(null)
  const dialogRef = useRef<DialogState | null>(null)
  dialogRef.current = dialog

  useEffect(() => {
    _subscribeFeedback((event: FeedbackEvent) => {
      if (event.kind === 'toast') {
        setToast(t => ({ msg: event.msg, seq: (t?.seq ?? 0) + 1 }))
        return
      }
      if (event.kind === 'file') {
        setFile({ blob: event.blob, filename: event.filename })
        return
      }
      // 新弹层替换旧弹层：旧调用按「取消」结算，避免 Promise 悬挂
      const prev = dialogRef.current
      if (prev) prev.resolve(cancelValue(prev) as never)
      if (event.kind === 'prompt') setPromptValue(event.defaultValue)
      setDialog(event)
    })
    return () => _subscribeFeedback(null)
  }, [])

  // Toast 自动消失（新 toast 重置计时）
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2400)
    return () => clearTimeout(t)
  }, [toast])

  // Esc 关闭弹层
  useEffect(() => {
    if (!dialog) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dialog.resolve(cancelValue(dialog) as never)
        setDialog(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dialog])

  return (
    <>
      {toast && (
        <div className="fb-toast" role="status" key={toast.seq}>
          {toast.msg}
        </div>
      )}

      {dialog?.kind === 'modal' && (
        <div className="fb-overlay" onClick={() => { dialog.resolve(cancelValue(dialog) as never); setDialog(null) }}>
          <div
            className="fb-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={dialog.opts.title}
            onClick={e => e.stopPropagation()}
          >
            <span className="fb-dialog__title">{dialog.opts.title}</span>
            {dialog.opts.content && <p className="fb-dialog__content">{dialog.opts.content}</p>}
            <div className="fb-dialog__actions">
              {dialog.opts.showCancel !== false && (
                <button
                  type="button"
                  className="fb-btn fb-btn--ghost"
                  onClick={() => { dialog.resolve(false); setDialog(null) }}
                >
                  {dialog.opts.cancelText ?? '取消'}
                </button>
              )}
              <button
                type="button"
                className="fb-btn fb-btn--primary"
                autoFocus
                onClick={() => { dialog.resolve(true); setDialog(null) }}
              >
                {dialog.opts.confirmText ?? '确定'}
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog?.kind === 'prompt' && (
        <div className="fb-overlay" onClick={() => { dialog.resolve(null); setDialog(null) }}>
          <div
            className="fb-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={dialog.title}
            onClick={e => e.stopPropagation()}
          >
            <form
              onSubmit={e => {
                e.preventDefault()
                dialog.resolve(promptValue)
                setDialog(null)
              }}
            >
              <span className="fb-dialog__title">{dialog.title}</span>
              <input
                className="fb-dialog__input"
                value={promptValue}
                onChange={e => setPromptValue(e.target.value)}
                autoFocus
                maxLength={40}
              />
              <div className="fb-dialog__actions">
                <button
                  type="button"
                  className="fb-btn fb-btn--ghost"
                  onClick={() => { dialog.resolve(null); setDialog(null) }}
                >
                  取消
                </button>
                <button type="submit" className="fb-btn fb-btn--primary">
                  确定
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {dialog?.kind === 'actionsheet' && (
        <div className="fb-overlay fb-overlay--sheet" onClick={() => { dialog.resolve(-1); setDialog(null) }}>
          <div className="fb-sheet" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            {dialog.items.map((item, i) => (
              <button
                key={i}
                type="button"
                className={`fb-sheet__item${item.destructive ? ' fb-sheet__item--destructive' : ''}`}
                onClick={() => { dialog.resolve(i); setDialog(null) }}
              >
                {item.text}
              </button>
            ))}
            <button
              type="button"
              className="fb-sheet__item fb-sheet__cancel"
              onClick={() => { dialog.resolve(-1); setDialog(null) }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {file && <FileSheet blob={file.blob} filename={file.filename} onClose={() => setFile(null)} />}
    </>
  )
}
