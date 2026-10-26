import { useEffect, useMemo, useState } from 'react'
import { directDownload, isInAppBrowser, isIOS, showToast } from '../../utils/webUtils'

interface Props {
  blob: Blob
  filename: string
  onClose: () => void
}

/**
 * 手机端导出面板：图片可预览并长按保存；支持系统分享时提供「保存到相册 / 分享」；
 * 微信等内置浏览器不能下载文件，给出替代方式。
 */
export default function FileSheet({ blob, filename, onClose }: Props) {
  const isImage = blob.type.startsWith('image/')
  const inApp   = isInAppBrowser()
  const file    = useMemo(() => new File([blob], filename, { type: blob.type }), [blob, filename])
  const canShare = !inApp && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  // iOS 的分享面板里有「存储图像」，作主按钮；安卓下载的图片会进相册，下载作主按钮
  const sharePrimary = canShare && isIOS()

  // 预览用 data URL：微信的长按菜单不识别 blob: 地址
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    if (!isImage) return
    const reader = new FileReader()
    reader.onload = () => setPreview(reader.result as string)
    reader.readAsDataURL(blob)
    return () => reader.abort()
  }, [blob, isImage])

  async function share() {
    try {
      await navigator.share({ files: [file] })
      onClose()
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') showToast('分享失败，请长按图片保存或下载文件')
    }
  }

  const tip = inApp
    ? isImage
      ? '长按图片，选择「保存图片」即可存到相册'
      : '微信内无法下载文件。请点右上角「···」，选择「在浏览器打开」后再导出'
    : isImage
      ? sharePrimary
        ? '点「保存到相册」后选择「存储图像」；也可以长按图片保存'
        : '下载后可在相册或「下载」文件夹中找到；也可以长按图片保存'
      : canShare ? '可以分享到微信、存到文件，或直接下载' : ''

  const shareText = isImage ? '保存到相册 / 分享' : '分享 / 存到文件'

  return (
    <div className="fb-overlay fb-overlay--sheet" onClick={onClose}>
      <div className="fb-sheet fb-file" role="dialog" aria-modal="true" aria-label="导出文件" onClick={e => e.stopPropagation()}>
        <span className="fb-dialog__title">{isImage ? '图片已生成' : '文件已生成'}</span>
        <span className="fb-file__name">{filename}</span>
        {isImage && (
          <div className="fb-file__preview">
            {preview ? <img src={preview} alt={filename} /> : <span className="fb-file__loading">生成预览…</span>}
          </div>
        )}
        {tip && <p className="fb-file__tip">{tip}</p>}
        <div className="fb-file__actions">
          {canShare && (
            <button type="button" className={`fb-btn ${sharePrimary ? 'fb-btn--primary' : 'fb-btn--ghost'}`} onClick={() => void share()}>
              {shareText}
            </button>
          )}
          {!inApp && (
            <button type="button" className={`fb-btn ${sharePrimary ? 'fb-btn--ghost' : 'fb-btn--primary'}`} onClick={() => { directDownload(blob, filename); onClose() }}>
              下载文件
            </button>
          )}
          <button type="button" className="fb-btn fb-btn--ghost" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}
