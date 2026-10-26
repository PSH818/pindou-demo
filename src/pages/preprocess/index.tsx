import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { showToast, getImageDimensions } from '../../utils/webUtils'
import { useRevokeOnUnmount } from '../../hooks/useRevokeOnUnmount'
import Button from '../../components/Button'
import flipHIcon from '../../assets/icons/flip-horizontal.svg'
import flipVIcon from '../../assets/icons/flip-vertical.svg'
import cropIcon from '../../assets/icons/crop.svg'
import frameResetIcon from '../../assets/icons/frame-reset.svg'
import scissorsIcon from '../../assets/icons/scissors.svg'
import undoIcon from '../../assets/icons/undo.svg'
import { clamp, computeNewCrop, inBox, nearHandle, type CropRect, type DragHandle } from '../../utils/cropGeometry'
import './index.scss'

// ─── 类型 ──────────────────────────────────────────────────────

interface ImgSize  { w: number; h: number }
interface ContainerRect { left: number; top: number; w: number; h: number }
interface DispRect {
  dispW: number; dispH: number
  offsetX: number; offsetY: number
  displayScale: number
}
interface DragState {
  handle: DragHandle
  startX: number; startY: number
  startCrop: CropRect
}

// ─── 组件 ────────────────────────────────────────────────────

export default function PreprocessPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const imagePath = decodeURIComponent(searchParams.get('imagePath') || '')

  const [imgSize, setImgSize]               = useState<ImgSize | null>(null)
  const [cRect, setCRect]                   = useState<ContainerRect | null>(null)
  const [mirrorH, setMirrorH]               = useState(false)
  const [mirrorV, setMirrorV]               = useState(false)
  const [isCropping, setIsCropping]         = useState(false)
  const [cropRect, setCropRect]             = useState<CropRect | null>(null)
  const [applying, setApplying]             = useState(false)
  const [removing, setRemoving]             = useState(false)
  const [removeProgress, setRemoveProgress] = useState('')
  const [removedPath, setRemovedPath]       = useState<string | null>(null)
  const removeBusyRef = useRef(false)
  const removeRunRef = useRef(0)

  const displayPath = removedPath ?? imagePath
  const imageAreaRef = useRef<HTMLDivElement>(null)

  const dragRef    = useRef<DragState | null>(null)
  const rafRef     = useRef<number | null>(null)
  const pendingRef = useRef<CropRect | null>(null)
  const transferredPathRef = useRef<string | null>(null)

  const dispRect = useMemo<DispRect | null>(() => {
    if (!imgSize || !cRect) return null
    const displayScale = Math.min(cRect.w / imgSize.w, cRect.h / imgSize.h)
    const dispW = imgSize.w * displayScale
    const dispH = imgSize.h * displayScale
    return {
      dispW, dispH,
      offsetX: (cRect.w - dispW) / 2,
      offsetY: (cRect.h - dispH) / 2,
      displayScale,
    }
  }, [imgSize, cRect])

  // ── 初始化 ───────────────────────────────────────────────────

  useEffect(() => () => {
    removeRunRef.current++
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
  }, [])

  // StrictMode 安全：仅真实卸载且图片未交接给编辑器时回收 blob URL
  useRevokeOnUnmount(() =>
    transferredPathRef.current === imagePath ? [] : [imagePath]
  )

  useEffect(() => {
    if (!imagePath) return
    getImageDimensions(imagePath)
      .then(({ width, height }) => setImgSize({ w: width, h: height }))
      .catch(console.error)
  }, [imagePath])

  useEffect(() => {
    const el = imageAreaRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setCRect({ left: r.left, top: r.top, w: r.width, h: r.height })

    const observer = new ResizeObserver(() => {
      const r2 = el.getBoundingClientRect()
      setCRect({ left: r2.left, top: r2.top, w: r2.width, h: r2.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ── 去背景 ───────────────────────────────────────────────────

  const handleRemoveBg = useCallback(async () => {
    if (removing || applying || removedPath || removeBusyRef.current) return
    removeBusyRef.current = true
    const run = ++removeRunRef.current
    setRemoving(true)
    setRemoveProgress('准备中...')
    try {
      const { removeBackground } = await import('../../utils/backgroundRemoval')
      const result = await removeBackground(imagePath, message => { if (run === removeRunRef.current) setRemoveProgress(message) })
      if (run !== removeRunRef.current) return
      setRemovedPath(result)
      setCropRect(null)
      setIsCropping(false)
      // imgSize 不变——removeBackground 输出与原图等尺寸
    } catch (e: any) {
      if (run === removeRunRef.current) showToast(e?.message ?? '抠图失败，请重试')
    } finally {
      removeBusyRef.current = false
      if (run === removeRunRef.current) { setRemoving(false); setRemoveProgress('') }
    }
  }, [removing, applying, imagePath, removedPath])

  // ── 裁剪模式 ─────────────────────────────────────────────────

  const handleCropToggle = useCallback(() => {
    if (isCropping) {
      setIsCropping(false)
    } else {
      setIsCropping(true)
      if (!cropRect && dispRect) {
        setCropRect({ x: 0, y: 0, w: dispRect.dispW, h: dispRect.dispH })
      }
    }
  }, [isCropping, cropRect, dispRect])

  // ── 指针拖拽（鼠标 + 触摸统一走 Pointer Events）────────────────

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!e.isPrimary || !isCropping || !dispRect || !cRect) return
    const tx = e.clientX - cRect.left - dispRect.offsetX
    const ty = e.clientY - cRect.top  - dispRect.offsetY
    const cr = cropRect ?? { x: 0, y: 0, w: dispRect.dispW, h: dispRect.dispH }

    let handle: DragHandle
    if      (nearHandle(tx, ty, cr.x,        cr.y))        handle = 'tl'
    else if (nearHandle(tx, ty, cr.x + cr.w, cr.y))        handle = 'tr'
    else if (nearHandle(tx, ty, cr.x,        cr.y + cr.h)) handle = 'bl'
    else if (nearHandle(tx, ty, cr.x + cr.w, cr.y + cr.h)) handle = 'br'
    else if (inBox(tx, ty, cr))                             handle = 'body'
    else                                                    handle = 'new'

    dragRef.current = { handle, startX: tx, startY: ty, startCrop: { ...cr } }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [isCropping, dispRect, cRect, cropRect])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!e.isPrimary || !dragRef.current || !dispRect || !cRect) return
    const tx = e.clientX - cRect.left - dispRect.offsetX
    const ty = e.clientY - cRect.top  - dispRect.offsetY
    const { handle, startX, startY, startCrop } = dragRef.current
    const newCrop = computeNewCrop(handle, tx, ty, startX, startY, startCrop, dispRect.dispW, dispRect.dispH)

    pendingRef.current = newCrop
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        if (pendingRef.current) setCropRect(pendingRef.current)
        rafRef.current = null
      })
    }
  }, [dispRect, cRect])

  const handlePointerUp = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (pendingRef.current) {
      setCropRect(pendingRef.current)
      pendingRef.current = null
    }
    if (dragRef.current?.handle === 'new') {
      setCropRect(prev => (prev && prev.w < 20 && prev.h < 20) ? null : prev)
    }
    dragRef.current = null
  }, [])

  // ── 确认处理并跳转 ───────────────────────────────────────────

  const handleConfirm = useCallback(async () => {
    if (applying) return
    setApplying(true)
    try {
      if (!mirrorH && !mirrorV && !cropRect && !removedPath) {
        transferredPathRef.current = imagePath
        navigate(`/editor?imagePath=${encodeURIComponent(imagePath)}`)
        return
      }
      if (!mirrorH && !mirrorV && !cropRect && removedPath) {
        transferredPathRef.current = removedPath
        navigate(`/editor?imagePath=${encodeURIComponent(removedPath)}`)
        return
      }
      if (!imgSize || !dispRect) throw new Error('图片未加载')

      const { w: imgW, h: imgH } = imgSize
      const { displayScale } = dispRect

      let srcX = 0, srcY = 0, srcW = imgW, srcH = imgH
      if (cropRect) {
        srcW = Math.max(1, Math.round(cropRect.w / displayScale))
        srcH = Math.max(1, Math.round(cropRect.h / displayScale))
        srcX = Math.round(cropRect.x / displayScale)
        srcY = Math.round(cropRect.y / displayScale)
        if (mirrorH) srcX = imgW - srcX - srcW
        if (mirrorV) srcY = imgH - srcY - srcH
        srcX = clamp(srcX, 0, imgW - 1)
        srcY = clamp(srcY, 0, imgH - 1)
        srcW = Math.min(srcW, imgW - srcX)
        srcH = Math.min(srcH, imgH - srcY)
      }

      const outCanvas = document.createElement('canvas')
      outCanvas.width  = srcW
      outCanvas.height = srcH
      const ctx = outCanvas.getContext('2d') as CanvasRenderingContext2D

      if      (mirrorH && mirrorV) { ctx.translate(srcW, srcH); ctx.scale(-1, -1) }
      else if (mirrorH)            { ctx.translate(srcW, 0);    ctx.scale(-1, 1)  }
      else if (mirrorV)            { ctx.translate(0, srcH);    ctx.scale(1, -1)  }

      const img = new Image()
      img.crossOrigin = 'anonymous'
      await new Promise<void>((resolve, reject) => {
        img.onload  = () => resolve()
        img.onerror = () => reject(new Error('图片加载失败'))
        img.src = displayPath
      })
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH)

      const usePng = !!removedPath
      const newPath = outCanvas.toDataURL(usePng ? 'image/png' : 'image/jpeg', usePng ? 1 : 0.92)

      transferredPathRef.current = newPath
      navigate(`/editor?imagePath=${encodeURIComponent(newPath)}`)
    } catch (e) {
      console.error('[preprocess]', e)
      showToast('处理失败，请重试')
    } finally {
      setApplying(false)
    }
  }, [applying, mirrorH, mirrorV, cropRect, removedPath, imagePath, displayPath, imgSize, dispRect, navigate])

  // ── 裁剪框叠层 ───────────────────────────────────────────────

  const renderCropLayer = () => {
    if (!isCropping || !dispRect || !cRect) return null
    const cr = cropRect ?? { x: 0, y: 0, w: dispRect.dispW, h: dispRect.dispH }
    const { offsetX, offsetY } = dispRect
    const ax = offsetX + cr.x
    const ay = offsetY + cr.y
    const aw = cr.w
    const ah = cr.h
    const rightW  = Math.max(0, cRect.w - ax - aw)
    const bottomY = ay + ah

    return (
      <div className="preprocess-crop-layer">
        <div className="preprocess-mask" style={{ top: 0, left: 0, right: 0, height: `${ay}px` }} />
        <div className="preprocess-mask" style={{ top: `${ay}px`, left: 0, width: `${ax}px`, height: `${ah}px` }} />
        <div className="preprocess-mask" style={{ top: `${ay}px`, right: 0, width: `${rightW}px`, height: `${ah}px` }} />
        <div className="preprocess-mask" style={{ top: `${bottomY}px`, left: 0, right: 0, bottom: 0 }} />

        <div className="preprocess-cropbox" style={{ top: `${ay}px`, left: `${ax}px`, width: `${aw}px`, height: `${ah}px` }}>
          <div className="preprocess-third preprocess-third--h" style={{ top: `${ah / 3}px` }} />
          <div className="preprocess-third preprocess-third--h" style={{ top: `${ah * 2 / 3}px` }} />
          <div className="preprocess-third preprocess-third--v" style={{ left: `${aw / 3}px` }} />
          <div className="preprocess-third preprocess-third--v" style={{ left: `${aw * 2 / 3}px` }} />
        </div>

        <div className="preprocess-handle preprocess-handle--tl" style={{ top: `${ay}px`, left: `${ax}px` }}>
          <div className="preprocess-handle__dot" />
        </div>
        <div className="preprocess-handle preprocess-handle--tr" style={{ top: `${ay}px`, left: `${ax + aw}px` }}>
          <div className="preprocess-handle__dot" />
        </div>
        <div className="preprocess-handle preprocess-handle--bl" style={{ top: `${ay + ah}px`, left: `${ax}px` }}>
          <div className="preprocess-handle__dot" />
        </div>
        <div className="preprocess-handle preprocess-handle--br" style={{ top: `${ay + ah}px`, left: `${ax + aw}px` }}>
          <div className="preprocess-handle__dot" />
        </div>
      </div>
    )
  }

  const imgTransform = [mirrorH ? 'scaleX(-1)' : '', mirrorV ? 'scaleY(-1)' : ''].filter(Boolean).join(' ') || undefined

  return (
    <div className="preprocess-page">
      <div className="preprocess-topbar">
        <Button className="preprocess-topbar__back" onClick={() => navigate(-1)}>
          <span className="preprocess-topbar__back-text">‹ 返回</span>
        </Button>
        <div className="preprocess-topbar__identity">
          <span className="preprocess-topbar__title">图片处理</span>
          <span className="topbar-step-badge">步骤 1/3</span>
        </div>
        <Button
          className={`preprocess-topbar__confirm${applying ? ' preprocess-topbar__confirm--disabled' : ''}`}
          disabled={applying}
          onClick={handleConfirm}
        >
          <span className="preprocess-topbar__confirm-text">
            {applying ? '处理中…' : '下一步 ›'}
          </span>
        </Button>
      </div>

      <div
        ref={imageAreaRef}
        className="preprocess-image-area"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <img
          className="preprocess-image"
          src={displayPath}
          style={{ transform: imgTransform, maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          alt=""
        />
        {renderCropLayer()}
      </div>

      <div className="preprocess-toolbar">
        <Button
          className={`preprocess-tool-btn${mirrorH ? ' preprocess-tool-btn--active' : ''}`}
          aria-pressed={mirrorH}
          onClick={() => setMirrorH(v => !v)}
        >
          <img className="preprocess-tool-icon-img" src={flipHIcon} alt="" />
          <span className="preprocess-tool-label">水平镜像</span>
        </Button>

        <Button
          className={`preprocess-tool-btn${mirrorV ? ' preprocess-tool-btn--active' : ''}`}
          aria-pressed={mirrorV}
          onClick={() => setMirrorV(v => !v)}
        >
          <img className="preprocess-tool-icon-img" src={flipVIcon} alt="" />
          <span className="preprocess-tool-label">垂直翻转</span>
        </Button>

        <Button
          className={`preprocess-tool-btn${isCropping ? ' preprocess-tool-btn--active' : ''}`}
          aria-pressed={isCropping}
          onClick={handleCropToggle}
        >
          <img className="preprocess-tool-icon-img" src={cropIcon} alt="" />
          <span className="preprocess-tool-label">{isCropping ? '完成裁剪' : '裁剪'}</span>
        </Button>

        {cropRect && !isCropping && (
          <Button className="preprocess-tool-btn" onClick={() => setCropRect(null)}>
            <img className="preprocess-tool-icon-img" src={frameResetIcon} alt="" />
            <span className="preprocess-tool-label">重置裁剪</span>
          </Button>
        )}

        <Button
          className={`preprocess-tool-btn${removedPath ? ' preprocess-tool-btn--active' : ''}`}
          disabled={removing || applying || !!removedPath}
          onClick={handleRemoveBg}
        >
          <img className="preprocess-tool-icon-img" src={scissorsIcon} alt="" />
          <span className="preprocess-tool-label">去背景</span>
        </Button>

        {removedPath && (
          <Button className="preprocess-tool-btn" onClick={() => {
            setRemovedPath(null)
            setImgSize(null)
            getImageDimensions(imagePath)
              .then(({ width, height }) => setImgSize({ w: width, h: height }))
              .catch(console.error)
          }}>
            <img className="preprocess-tool-icon-img" src={undoIcon} alt="" />
            <span className="preprocess-tool-label">重置抠图</span>
          </Button>
        )}
      </div>

      {removing && (
        <div className="preprocess-removing-overlay">
          <span className="preprocess-removing-text">{removeProgress || '处理中...'}</span>
        </div>
      )}
    </div>
  )
}
