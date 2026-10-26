import { useEffect, useRef, useCallback } from 'react'
import { usePatternStore } from '../../store/patternStore'
import { renderFull, renderSingleCell, CODE_MIN_SCALE_TOGGLE, type RenderOptions } from './renderer'
import type { BeadColor } from '../../types'
import { TRANSPARENT } from '../../types'
import { getCanvasFromRef } from '../../utils/canvasHelper'
import './index.scss'

const CANVAS_ID   = 'pattern-canvas'
const SCALE_MIN_CSS = 4
const SCALE_MAX_CSS = 32

interface Props {
  brandColors:   BeadColor[]
  showColorCode: boolean
  showRuler?:    boolean
}

export default function PatternCanvas({ brandColors, showColorCode, showRuler = false }: Props) {

  const canvasRef      = useRef<HTMLCanvasElement>(null)
  const ctxRef         = useRef<CanvasRenderingContext2D | null>(null)
  const canvasSizeRef  = useRef({ w: 0, h: 0 })
  const canvasRectRef  = useRef({ left: 0, top: 0 })
  const dprRef         = useRef(1)
  const isReadyRef     = useRef(false)

  const tfRef = useRef({ scale: 16, offsetX: 0, offsetY: 0 })

  const touchRef = useRef({
    mode:      'idle' as 'idle' | 'drawing' | 'pinching',
    pinchDist: 0,
    pinchMidX: 0, pinchMidY: 0,
    prevCellX: -1, prevCellY: -1,
  })

  const pattern           = usePatternStore(s => s.pattern)
  const highlightColorIdx = usePatternStore(s => s.highlightColorIdx)
  const showGuideLines    = usePatternStore(s => s.showGuideLines)
  const guideLinesColor   = usePatternStore(s => s.guideLinesColor)
  const paintCell         = usePatternStore(s => s.paintCell)
  const eraseCell         = usePatternStore(s => s.eraseCell)
  const fillRegion        = usePatternStore(s => s.fillRegion)
  const pickColor         = usePatternStore(s => s.pickColor)

  const toolRef = useRef(usePatternStore.getState().tool)
  useEffect(() => {
    return usePatternStore.subscribe(
      state => { toolRef.current = state.tool }
    )
  }, [])

  function physThresh(cssPx: number) {
    return Math.round(cssPx * dprRef.current)
  }

  const renderFnRef = useRef<() => void>(() => {})

  useEffect(() => {
    renderFnRef.current = () => {
      if (!ctxRef.current || !isReadyRef.current || !pattern) return
      const { w, h } = canvasSizeRef.current
      const opts: RenderOptions = {
        ...tfRef.current,
        showGrid:       true,
        circular:       false,
        highlightColorIdx,
        showColorCode,
        showRuler,
        showGuideLines,
        guideLinesEvery: 5,
        guideLinesColor,
      }
      renderFull(ctxRef.current, w, h, pattern, brandColors, opts)
    }
  })

  useEffect(() => {
    renderFnRef.current()
  }, [pattern, highlightColorIdx, brandColors, showColorCode, showRuler, showGuideLines, guideLinesColor])

  // ─── Canvas 初始化（Web 版，直接用 ref）──────────────────────

  useEffect(() => {
    const canvasContext = getCanvasFromRef(canvasRef)
    if (!canvasContext) return
    const { canvas, ctx } = canvasContext

    const dpr  = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const cssW = rect.width  || canvas.offsetWidth  || 300
    const cssH = rect.height || canvas.offsetHeight || 300

    const physW = Math.round(cssW * dpr)
    const physH = Math.round(cssH * dpr)

    dprRef.current        = dpr
    canvasSizeRef.current = { w: physW, h: physH }
    canvasRectRef.current = { left: rect.left, top: rect.top }

    canvas.width  = physW
    canvas.height = physH

    ctx.imageSmoothingEnabled = false
    ctxRef.current     = ctx
    isReadyRef.current = true

    if (pattern) {
      resetTransform(physW, physH, pattern.width, pattern.height)
    }
    renderFnRef.current()

    // 监听尺寸变化
    const observer = new ResizeObserver(() => {
      const r   = canvas.getBoundingClientRect()
      const pW  = Math.round(r.width  * dpr)
      const pH  = Math.round(r.height * dpr)
      if (pW === canvasSizeRef.current.w && pH === canvasSizeRef.current.h) return
      canvas.width  = pW
      canvas.height = pH
      canvasSizeRef.current = { w: pW, h: pH }
      canvasRectRef.current = { left: r.left, top: r.top }
      renderFnRef.current()
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  // ─── 变换工具函数 ─────────────────────────────────────────

  function resetTransform(physW: number, physH: number, patW: number, patH: number) {
    const dpr      = dprRef.current
    const scaleMin = Math.round(SCALE_MIN_CSS * dpr)
    const scaleMax = Math.round(SCALE_MAX_CSS * dpr)
    const scale = Math.max(scaleMin, Math.min(scaleMax, Math.round(
      Math.min(physW * 0.88 / patW, physH * 0.88 / patH)
    )))
    tfRef.current = {
      scale,
      offsetX: Math.round((physW - patW * scale) / 2),
      offsetY: Math.round((physH - patH * scale) / 2),
    }
  }

  function clampTransform() {
    if (!pattern) return
    const { w, h } = canvasSizeRef.current
    const { scale, offsetX, offsetY } = tfRef.current
    const patW   = pattern.width  * scale
    const patH   = pattern.height * scale
    const margin = Math.round(60 * dprRef.current)
    tfRef.current = {
      scale,
      offsetX: Math.min(w - margin, Math.max(margin - patW, offsetX)),
      offsetY: Math.min(h - margin, Math.max(margin - patH, offsetY)),
    }
  }

  // ─── 坐标工具函数 ─────────────────────────────────────────

  function touchToCell(clientX: number, clientY: number) {
    const dpr = dprRef.current
    const { left, top } = canvasRectRef.current
    const { scale, offsetX, offsetY } = tfRef.current
    const physX = (clientX - left) * dpr
    const physY = (clientY - top)  * dpr
    return {
      cellX: Math.floor((physX - offsetX) / scale),
      cellY: Math.floor((physY - offsetY) / scale),
    }
  }

  function inBounds(cellX: number, cellY: number): boolean {
    if (!pattern) return false
    return cellX >= 0 && cellX < pattern.width && cellY >= 0 && cellY < pattern.height
  }

  function calcPinchDist(t0: React.Touch, t1: React.Touch): number {
    const dpr = dprRef.current
    const dx  = (t0.clientX - t1.clientX) * dpr
    const dy  = (t0.clientY - t1.clientY) * dpr
    return Math.sqrt(dx * dx + dy * dy)
  }

  // ─── 工具应用 ─────────────────────────────────────────────

  function applyTool(cellX: number, cellY: number) {
    if (!inBounds(cellX, cellY)) return
    switch (toolRef.current) {
      case 'brush':      paintCell(cellX, cellY);  break
      case 'eraser':     eraseCell(cellX, cellY);  break
      case 'fill':       fillRegion(cellX, cellY); break
      case 'eyedropper': pickColor(cellX, cellY);  break
    }
  }

  function fastPaintCell(cellX: number, cellY: number) {
    if (!ctxRef.current || !pattern || !inBounds(cellX, cellY)) return
    const tool = toolRef.current
    if (tool !== 'brush' && tool !== 'eraser') return

    tool === 'brush' ? paintCell(cellX, cellY) : eraseCell(cellX, cellY)

    const latestState = usePatternStore.getState()
    const latest = latestState.pattern
    if (!latest) return

    renderSingleCell(
      ctxRef.current,
      cellX, cellY,
      latest,
      brandColors,
      {
        ...tfRef.current,
        showGrid:      true,
        circular:      false,
        highlightColorIdx: latestState.highlightColorIdx,
        showColorCode: showColorCode,
        showRuler,
      }
    )
  }

  // ─── 触摸/鼠标事件 ────────────────────────────────────────

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    const touches = e.touches
    const ts = touchRef.current

    if (touches.length === 1) {
      ts.mode = 'drawing'
      const { cellX, cellY } = touchToCell(touches[0].clientX, touches[0].clientY)
      ts.prevCellX = cellX
      ts.prevCellY = cellY

      const tool = toolRef.current
      if (tool === 'fill' || tool === 'eyedropper') {
        applyTool(cellX, cellY)
        ts.mode = 'idle'
      } else {
        fastPaintCell(cellX, cellY)
      }

    } else if (touches.length >= 2) {
      ts.mode      = 'pinching'
      ts.pinchDist = calcPinchDist(touches[0], touches[1])
      ts.pinchMidX = (touches[0].clientX + touches[1].clientX) / 2
      ts.pinchMidY = (touches[0].clientY + touches[1].clientY) / 2
    }
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    const touches = e.touches
    const ts      = touchRef.current

    if (ts.mode === 'drawing' && touches.length === 1) {
      const { cellX, cellY } = touchToCell(touches[0].clientX, touches[0].clientY)
      if (cellX === ts.prevCellX && cellY === ts.prevCellY) return
      ts.prevCellX = cellX
      ts.prevCellY = cellY
      fastPaintCell(cellX, cellY)

    } else if (ts.mode === 'pinching' && touches.length >= 2) {
      const dpr      = dprRef.current
      const newDist  = calcPinchDist(touches[0], touches[1])
      const newMidX  = (touches[0].clientX + touches[1].clientX) / 2
      const newMidY  = (touches[0].clientY + touches[1].clientY) / 2
      const { left, top } = canvasRectRef.current

      const scaleFactor  = newDist / ts.pinchDist
      const { scale, offsetX, offsetY } = tfRef.current

      const scaleMin = Math.round(SCALE_MIN_CSS * dpr)
      const scaleMax = Math.round(SCALE_MAX_CSS * dpr)
      const newScale = Math.min(scaleMax, Math.max(scaleMin, scale * scaleFactor))

      const midPhysX = (newMidX - left) * dpr
      const midPhysY = (newMidY - top)  * dpr
      const newOffsetX = midPhysX - (midPhysX - offsetX) * (newScale / scale)
                       + (newMidX - ts.pinchMidX) * dpr
      const newOffsetY = midPhysY - (midPhysY - offsetY) * (newScale / scale)
                       + (newMidY - ts.pinchMidY) * dpr

      tfRef.current = { scale: newScale, offsetX: newOffsetX, offsetY: newOffsetY }
      clampTransform()

      ts.pinchDist = newDist
      ts.pinchMidX = newMidX
      ts.pinchMidY = newMidY

      renderFnRef.current()
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    touchRef.current.mode      = 'idle'
    touchRef.current.prevCellX = -1
    touchRef.current.prevCellY = -1
  }, [])

  // ─── 鼠标支持（桌面端）────────────────────────────────────
  // 左键作画；按住空格 + 左键、或中键 / 右键拖动平移画布

  const mouseDownRef = useRef(false)
  const spaceHeldRef = useRef(false)
  const panRef       = useRef<{ x: number; y: number } | null>(null)

  function setCursor(cursor: string) {
    if (canvasRef.current) canvasRef.current.style.cursor = cursor
  }

  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping(e.target)) return
      e.preventDefault()
      if (!spaceHeldRef.current) { spaceHeldRef.current = true; if (!panRef.current) setCursor('grab') }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      spaceHeldRef.current = false
      if (!panRef.current) setCursor('')
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceHeldRef.current)) {
      e.preventDefault()
      panRef.current = { x: e.clientX, y: e.clientY }
      setCursor('grabbing')
      return
    }
    if (e.button !== 0) return
    mouseDownRef.current = true
    const { cellX, cellY } = touchToCell(e.clientX, e.clientY)
    const tool = toolRef.current
    if (tool === 'fill' || tool === 'eyedropper') {
      applyTool(cellX, cellY)
    } else {
      touchRef.current.prevCellX = cellX
      touchRef.current.prevCellY = cellY
      fastPaintCell(cellX, cellY)
    }
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const pan = panRef.current
    if (pan) {
      const dpr = dprRef.current
      const { scale, offsetX, offsetY } = tfRef.current
      tfRef.current = { scale, offsetX: offsetX + (e.clientX - pan.x) * dpr, offsetY: offsetY + (e.clientY - pan.y) * dpr }
      panRef.current = { x: e.clientX, y: e.clientY }
      clampTransform()
      renderFnRef.current()
      return
    }
    if (!mouseDownRef.current) return
    const { cellX, cellY } = touchToCell(e.clientX, e.clientY)
    if (cellX === touchRef.current.prevCellX && cellY === touchRef.current.prevCellY) return
    touchRef.current.prevCellX = cellX
    touchRef.current.prevCellY = cellY
    fastPaintCell(cellX, cellY)
  }, [])

  const handleMouseUp = useCallback(() => {
    mouseDownRef.current = false
    if (panRef.current) {
      panRef.current = null
      setCursor(spaceHeldRef.current ? 'grab' : '')
    }
  }, [])

  // ─── 滚轮缩放 ─────────────────────────────────────────────

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const dpr      = dprRef.current
    const factor   = e.deltaY < 0 ? 1.1 : 0.9
    const { scale, offsetX, offsetY } = tfRef.current
    const scaleMin = Math.round(SCALE_MIN_CSS * dpr)
    const scaleMax = Math.round(SCALE_MAX_CSS * dpr)
    const newScale = Math.min(scaleMax, Math.max(scaleMin, scale * factor))

    const { left, top } = canvasRectRef.current
    const midPhysX = (e.clientX - left) * dpr
    const midPhysY = (e.clientY - top)  * dpr
    const newOffsetX = midPhysX - (midPhysX - offsetX) * (newScale / scale)
    const newOffsetY = midPhysY - (midPhysY - offsetY) * (newScale / scale)

    tfRef.current = { scale: newScale, offsetX: newOffsetX, offsetY: newOffsetY }
    clampTransform()
    renderFnRef.current()
  }, [])

  // ─── 视图按钮：以画布中心缩放 / 适合屏幕 ────────────────────

  function zoomBy(factor: number) {
    const dpr = dprRef.current
    const { w, h } = canvasSizeRef.current
    const { scale, offsetX, offsetY } = tfRef.current
    const newScale = Math.min(Math.round(SCALE_MAX_CSS * dpr), Math.max(Math.round(SCALE_MIN_CSS * dpr), scale * factor))
    tfRef.current = {
      scale: newScale,
      offsetX: w / 2 - (w / 2 - offsetX) * (newScale / scale),
      offsetY: h / 2 - (h / 2 - offsetY) * (newScale / scale),
    }
    clampTransform()
    renderFnRef.current()
  }

  function fitToScreen() {
    const latest = usePatternStore.getState().pattern
    if (!latest) return
    const { w, h } = canvasSizeRef.current
    resetTransform(w, h, latest.width, latest.height)
    renderFnRef.current()
  }

  // ─── JSX ─────────────────────────────────────────────────

  return (
    <>
      <canvas
        id={CANVAS_ID}
        ref={canvasRef}
        className="pattern-canvas"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={e => e.preventDefault()}
        onWheel={handleWheel}
      />
      <div className="pattern-canvas-view">
        <button type="button" className="pattern-canvas-view__btn" aria-label="缩小" title="缩小" onClick={() => zoomBy(1 / 1.25)}>−</button>
        <button type="button" className="pattern-canvas-view__btn" aria-label="放大" title="放大" onClick={() => zoomBy(1.25)}>+</button>
        <button type="button" className="pattern-canvas-view__btn pattern-canvas-view__btn--fit" onClick={fitToScreen}>适合屏幕</button>
        <span className="pattern-canvas-view__hint">滚轮缩放 · 空格或右键拖动</span>
      </div>
    </>
  )
}
