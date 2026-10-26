import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import ColorTable from '../../components/ColorTable'
import { loadImageInfo, buildPattern, calcColorEntries, exportColorEntriesCSV } from '../../utils/analyzePattern'
import { BRAND_OPTIONS, loadBrand } from '../../utils/palette'
import { savePattern } from '../../utils/storage'
import { usePatternStore } from '../../store/patternStore'
import { showToast, pickImageFile, getImageDimensions, revokeObjectUrl } from '../../utils/webUtils'
import { useRevokeOnUnmount } from '../../hooks/useRevokeOnUnmount'
import { MAX_GRID_SIDE, validateGridDimensions } from '../../utils/patternLimits'
import { parseManualGridCount } from '../../utils/manualGridCount'
import { clamp, computeNewCrop, inBox, nearHandle, type CropRect, type DragHandle } from '../../utils/cropGeometry'
import type { BrandId, BeadColor } from '../../types'
import type { ColorEntry } from '../../utils/analyzePattern'
import './index.scss'

// ─── 类型 ─────────────────────────────────────────────────────

type Stage = 'upload' | 'crop' | 'analyzing' | 'done' | 'error'

interface ImgSize     { w: number; h: number }
interface DragState   { handle: DragHandle; startX: number; startY: number; startCrop: CropRect }

interface AnalysisResult {
  grid:        Uint16Array
  paletteUsed: number[]
  cols:        number
  rows:        number
  colors:      BeadColor[]
  entries:     ColorEntry[]
  brandId:     BrandId
  detectedCrop: CropRect | null
}

// ─── 主组件 ───────────────────────────────────────────────────

export default function AnalyzePage() {
  const navigate  = useNavigate()
  const setPattern = usePatternStore(s => s.setPattern)

  const [stage, setStage]           = useState<Stage>('upload')
  const [imageUrl, setImageUrl]     = useState<string | null>(null)
  const [imgSize, setImgSize]       = useState<ImgSize | null>(null)
  const [cropRect, setCropRect]     = useState<CropRect | null>(null)
  const [autoLocate, setAutoLocate] = useState(true)
  const [brandId, setBrandId]       = useState<BrandId>('mard')
  const [progress, setProgress]     = useState(0)
  const [errorMsg, setErrorMsg]     = useState('')
  const [manualCols, setManualCols] = useState('')
  const [manualRows, setManualRows] = useState('')
  const [result, setResult]         = useState<AnalysisResult | null>(null)
  const [patternName, setPatternName] = useState('导入图纸')
  const [openingEditor, setOpeningEditor] = useState(false)
  const openingEditorRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const imageAreaRef = useRef<HTMLDivElement>(null)
  const [imageAreaSize, setImageAreaSize] = useState<ImgSize | null>(null)
  const dragRef      = useRef<DragState | null>(null)
  const rafRef       = useRef<number | null>(null)
  const pendingRef   = useRef<CropRect | null>(null)
  const workerRef    = useRef<Worker | null>(null)
  const runIdRef     = useRef(0)
  const analysisAbortRef = useRef<AbortController | null>(null)

  useEffect(() => () => {
    runIdRef.current++
    analysisAbortRef.current?.abort()
    analysisAbortRef.current = null
    workerRef.current?.terminate()
    workerRef.current = null
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
  }, [])

  // StrictMode 安全：仅真实卸载时回收 blob URL（换图时的旧 URL 由 handleFileLoad 回收）
  useRevokeOnUnmount(() => [imageUrl])

  // 条件渲染的图片区必须挂载后再测量；窗口变化、移动端转屏时也要更新。
  useLayoutEffect(() => {
    const area = imageAreaRef.current
    if (stage !== 'crop' || !area) return
    const measure = () => {
      const { width: w, height: h } = area.getBoundingClientRect()
      setImageAreaSize(previous => previous?.w === w && previous?.h === h ? previous : { w, h })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(area)
    return () => {
      observer.disconnect()
      dragRef.current = null
      pendingRef.current = null
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [stage, imgSize])

  // 与 CSS object-fit: contain 一致，小图也可能被放大。
  const dispRect = useMemo(() => {
    if (stage !== 'crop' || !imgSize || !imageAreaSize || imageAreaSize.w <= 0 || imageAreaSize.h <= 0) return null
    const cW = imageAreaSize.w, cH = imageAreaSize.h
    const scale = Math.min(cW / imgSize.w, cH / imgSize.h)
    const dW = imgSize.w * scale, dH = imgSize.h * scale
    return {
      dispW: dW, dispH: dH,
      offsetX: (cW - dW) / 2, offsetY: (cH - dH) / 2,
      scale,
    }
  }, [imgSize, imageAreaSize, stage])

  // 加载图片 URL → 进入 crop 阶段（供文件选择和粘贴共用）
  const handleFileLoad = useCallback(async (url: string) => {
    try {
      const { width, height } = await getImageDimensions(url)
      setImageUrl(previous => {
        if (previous !== url) revokeObjectUrl(previous)
        return url
      })
      setImgSize({ w: width, h: height })
      setCropRect({ x: 0, y: 0, w: width, h: height })
      setAutoLocate(true)
      setStage('crop')
    } catch (error) {
      revokeObjectUrl(url)
      throw error
    }
  }, [])

  // 上传图片（点击选择文件）
  const handleUpload = useCallback(async () => {
    try {
      const url = await pickImageFile()
      if (!url) return
      await handleFileLoad(url)
    } catch (e: any) {
      if (!String(e?.message).includes('cancel') && !String(e?.message).includes('取消')) {
        showToast('选图失败，请重试')
      }
    }
  }, [handleFileLoad])

  // Ctrl+V 粘贴图片（仅 upload 阶段）
  useEffect(() => {
    if (stage !== 'upload') return
    async function onPaste(e: ClipboardEvent) {
      const file = Array.from(e.clipboardData?.items ?? [])
        .find(item => item.type.startsWith('image/'))
        ?.getAsFile()
      if (!file) return
      try {
        await handleFileLoad(URL.createObjectURL(file))
      } catch {
        showToast('图片加载失败，请重试')
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [stage, handleFileLoad])

  // ── 拖拽裁剪框 ───────────────────────────────────────────────

  function toImageCoords(clientX: number, clientY: number) {
    if (!imageAreaRef.current || !dispRect || !imgSize) return { tx: 0, ty: 0 }
    const rect = imageAreaRef.current.getBoundingClientRect()
    const px = (clientX - rect.left - dispRect.offsetX) / dispRect.scale
    const py = (clientY - rect.top  - dispRect.offsetY) / dispRect.scale
    return { tx: clamp(px, 0, imgSize.w), ty: clamp(py, 0, imgSize.h) }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || !cropRect || !dispRect || !imgSize) return
    const { tx, ty } = toImageCoords(e.clientX, e.clientY)
    // 把 cropRect 转成显示坐标判断 handle 命中
    const d = dispRect
    const cx = (tx: number) => tx * d.scale + d.offsetX + imageAreaRef.current!.getBoundingClientRect().left
    const cy2 = (ty: number) => ty * d.scale + d.offsetY + imageAreaRef.current!.getBoundingClientRect().top
    const px = e.clientX, py = e.clientY
    const { x, y, w, h } = cropRect
    let handle: DragHandle = 'new'
    if (nearHandle(px, py, cx(x),     cy2(y)))     handle = 'tl'
    else if (nearHandle(px, py, cx(x+w), cy2(y)))  handle = 'tr'
    else if (nearHandle(px, py, cx(x),   cy2(y+h))) handle = 'bl'
    else if (nearHandle(px, py, cx(x+w), cy2(y+h))) handle = 'br'
    else if (inBox(tx, ty, cropRect))               handle = 'body'
    dragRef.current = { handle, startX: tx, startY: ty, startCrop: { ...cropRect } }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current || !imgSize) return
    setAutoLocate(false)
    const { tx, ty } = toImageCoords(e.clientX, e.clientY)
    const { handle, startX, startY, startCrop } = dragRef.current
    const newCrop = computeNewCrop(handle, tx, ty, startX, startY, startCrop, imgSize.w, imgSize.h, Math.min(20, imgSize.w, imgSize.h))
    pendingRef.current = newCrop
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        if (pendingRef.current) { setCropRect(pendingRef.current); pendingRef.current = null }
      })
    }
  }

  function onPointerUp() {
    // 提交最后一次移动，避免松手后立即识别时使用上一帧的裁剪范围。
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    const next = pendingRef.current ?? cropRect
    if (dragRef.current && next) {
      setCropRect(next.w >= 1 && next.h >= 1 ? next : dragRef.current.startCrop)
    }
    pendingRef.current = null
    dragRef.current = null
  }

  function onPointerCancel() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (dragRef.current) setCropRect(dragRef.current.startCrop)
    pendingRef.current = null
    dragRef.current = null
  }

  // 将 image 坐标转为显示坐标（用于 SVG overlay 定位）
  function toDisp(v: number, axis: 'x' | 'y'): number {
    if (!dispRect) return 0
    return axis === 'x'
      ? v * dispRect.scale + dispRect.offsetX
      : v * dispRect.scale + dispRect.offsetY
  }

  // ── 开始识别 ─────────────────────────────────────────────────

  const handleAnalyze = useCallback(async () => {
    if (!imageUrl || !cropRect || !imgSize || analysisAbortRef.current) return
    const controller = new AbortController()
    analysisAbortRef.current = controller
    const { signal } = controller
    const runId = ++runIdRef.current
    setStage('analyzing')
    setProgress(0)
    setErrorMsg('')

    try {
      // Validate before decoding the image or launching a Worker.
      const mCols = parseManualGridCount(manualCols, '列数')
      const mRows = parseManualGridCount(manualRows, '行数')
      const [imageInfo, brand] = await Promise.all([
        loadImageInfo(imageUrl, { signal }),
        loadBrand(brandId),
      ])
      if (signal.aborted || runId !== runIdRef.current) return

      await new Promise<void>((resolve, reject) => {
        workerRef.current?.terminate()
        const worker = new Worker(
          new URL('../../workers/gridDetect.js', import.meta.url),
          { type: 'module' },
        )
        workerRef.current = worker
        let settled = false
        const finish = (error?: Error) => {
          if (settled) return
          settled = true
          signal.removeEventListener('abort', onAbort)
          worker.onmessage = null
          worker.onerror = null
          worker.onmessageerror = null
          worker.terminate()
          if (workerRef.current === worker) workerRef.current = null
          if (error) reject(error)
          else resolve()
        }
        const onAbort = () => finish(new DOMException('识别已取消', 'AbortError'))
        signal.addEventListener('abort', onAbort, { once: true })
        worker.onmessage = (e) => {
          if (signal.aborted || runId !== runIdRef.current) { onAbort(); return }
          try {
            const msg = e.data
            if (msg.type === 'progress') {
              setProgress(msg.progress)
            } else if (msg.type === 'result') {
              const dimensionError = validateGridDimensions(msg.cols, msg.rows)
              if (dimensionError) {
                finish(new Error(dimensionError))
                return
              }
              const grid = new Uint16Array(msg.grid)
              const entries = calcColorEntries(grid, msg.paletteUsed, brand.colors)
              setResult({
                grid,
                paletteUsed: msg.paletteUsed,
                cols:        msg.cols,
                rows:        msg.rows,
                colors:      brand.colors,
                entries,
                brandId,
                detectedCrop: msg.detectedCrop ?? null,
              })
              if (msg.detectedCrop) setCropRect(msg.detectedCrop)
              setStage('done')
              finish()
            } else if (msg.type === 'error') {
              finish(new Error(msg.error))
            }
          } catch (error) {
            finish(error instanceof Error ? error : new Error('识别结果读取失败，请重试'))
          }
        }
        worker.onerror = () => {
          finish(new Error('识别进程意外退出，请重试'))
        }
        worker.onmessageerror = () => finish(new Error('识别结果传输失败，请重试'))

        // transferable：将 imageData buffer 转移给 Worker
        const buf = imageInfo.imageData
        try { worker.postMessage({
          imageData:   buf,
          imageWidth:  imageInfo.width,
          imageHeight: imageInfo.height,
          cropX:  Math.round(cropRect.x),
          cropY:  Math.round(cropRect.y),
          cropW:  Math.round(cropRect.w),
          cropH:  Math.round(cropRect.h),
          manualCols: mCols,
          manualRows: mRows,
          autoLocate,
          palette: brand.colors.map(c => ({ id: c.id, rgb: c.rgb, lab: c.lab })),
        }, [buf]) } catch (error) {
          finish(error instanceof Error ? error : new Error('无法启动识别，请重试'))
        }
      })
    } catch (e: any) {
      if (signal.aborted || runId !== runIdRef.current) return
      setErrorMsg(e?.message || '识别失败，请重试')
      setStage('error')
    } finally {
      controller.abort()
      if (analysisAbortRef.current === controller) analysisAbortRef.current = null
    }
  }, [imageUrl, cropRect, imgSize, brandId, manualCols, manualRows, autoLocate])

  // ── 在编辑器中打开 ────────────────────────────────────────────

  const handleOpenEditor = useCallback(async () => {
    // Ref locks synchronously, before React has rendered the disabled button.
    if (!result || openingEditorRef.current) return
    openingEditorRef.current = true
    setOpeningEditor(true)
    try {
      const brand = await loadBrand(result.brandId)
      const pattern = await buildPattern(
        result.grid, result.paletteUsed, result.cols, result.rows,
        result.brandId, brand.colors, patternName,
      )
      await savePattern(pattern)
      if (!mountedRef.current) return
      setPattern(pattern)
      navigate(`/editor?patternId=${pattern.id}`)
      // Keep the lock until unmount after successful navigation.
    } catch (error) {
      openingEditorRef.current = false
      if (mountedRef.current) {
        setOpeningEditor(false)
        showToast(error instanceof Error ? error.message : '打开失败，请重试')
      }
    }
  }, [result, patternName, navigate, setPattern])

  // ── 导出 CSV ─────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    if (!result) return
    exportColorEntriesCSV(result.entries, patternName)
  }, [result, patternName])

  // ── 图纸预览 Canvas ──────────────────────────────────────────

  const previewCanvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (stage !== 'done' || !result || !previewCanvasRef.current) return
    const canvas = previewCanvasRef.current
    const { grid, paletteUsed, cols, rows, colors } = result
    const colorById = new Map(colors.map(c => [c.id, c]))
    const SIZE = Math.min(400, cols * 10, rows * 10)
    const cellPx = Math.max(1, Math.floor(SIZE / Math.max(cols, rows)))
    canvas.width  = cols * cellPx
    canvas.height = rows * cellPx
    const ctx = canvas.getContext('2d')!
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = grid[row * cols + col]
        const colorId = paletteUsed[idx]
        const c = colorById.get(colorId)
        if (!c) continue
        ctx.fillStyle = `rgb(${c.rgb[0]},${c.rgb[1]},${c.rgb[2]})`
        ctx.fillRect(col * cellPx, row * cellPx, cellPx, cellPx)
      }
    }
  }, [stage, result])

  // ── 渲染 ─────────────────────────────────────────────────────

  return (
    <div className="analyze-page">
      {/* 顶部导航栏 */}
      <div className="analyze-nav">
        <button className="analyze-nav__back" disabled={openingEditor} onClick={() => navigate('/')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <span className="analyze-nav__title">
          {stage === 'done' ? '识别结果' : '分析图纸'}
        </span>
        {stage === 'done' && (
          <input
            className="analyze-nav__name"
            disabled={openingEditor}
            value={patternName}
            onChange={e => setPatternName(e.target.value)}
            placeholder="图纸名称"
            maxLength={40}
          />
        )}
      </div>

      {/* ── 上传阶段 ─────────────────────────────────────────── */}
      {stage === 'upload' && (
        <div className="analyze-upload" onClick={handleUpload}>
          <div className="analyze-upload__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <p className="analyze-upload__title">上传拼豆图纸</p>
          <p className="analyze-upload__hint">点击选择图片，或 Ctrl+V 粘贴</p>
          <p className="analyze-upload__hint analyze-upload__hint--sub">支持从网络下载的数字图纸（PNG / JPG）</p>
        </div>
      )}

      {/* ── 裁剪 + 设置阶段 ──────────────────────────────────── */}
      {stage === 'crop' && imageUrl && imgSize && (
        <div className="analyze-crop-layout">
          {/* 图片区 */}
          <div className="analyze-image-area" ref={imageAreaRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onLostPointerCapture={onPointerUp}
            style={{ touchAction: 'none' }}
          >
            <img className="analyze-image" src={imageUrl} alt="" draggable={false} />

            {cropRect && dispRect && (
              <svg className="analyze-overlay" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                {/* 遮罩（裁剪区外变暗） */}
                <defs>
                  <mask id="crop-mask">
                    <rect width="100%" height="100%" fill="white"/>
                    <rect
                      x={toDisp(cropRect.x, 'x')} y={toDisp(cropRect.y, 'y')}
                      width={cropRect.w * dispRect.scale} height={cropRect.h * dispRect.scale}
                      fill="black"
                    />
                  </mask>
                </defs>
                <rect width="100%" height="100%" fill="rgba(0,0,0,0.45)" mask="url(#crop-mask)"/>
                {/* 裁剪框边框 */}
                <rect
                  x={toDisp(cropRect.x, 'x')} y={toDisp(cropRect.y, 'y')}
                  width={cropRect.w * dispRect.scale} height={cropRect.h * dispRect.scale}
                  fill="none" stroke="#F0874E" strokeWidth="1.5"
                />
                {/* 四角把手 */}
                {([
                  [cropRect.x,             cropRect.y            ],
                  [cropRect.x + cropRect.w, cropRect.y            ],
                  [cropRect.x,             cropRect.y + cropRect.h],
                  [cropRect.x + cropRect.w, cropRect.y + cropRect.h],
                ] as [number, number][]).map(([ix, iy], i) => (
                  <circle
                    key={i}
                    cx={toDisp(ix, 'x')} cy={toDisp(iy, 'y')} r={7}
                    fill="#F0874E" stroke="#fff" strokeWidth="2"
                  />
                ))}
              </svg>
            )}
          </div>

          {/* 设置栏 */}
          <div className="analyze-settings">
            <p className="analyze-settings__hint">
              可直接识别完整图纸，自动寻找网格并排除外围图例和留白；识别不准确时再手动调整范围。
            </p>

            <label className="analyze-field__sub">
              <input type="checkbox" checked={autoLocate} onChange={e => setAutoLocate(e.target.checked)} />
              自动定位网格区域（手动拖动裁剪框后关闭）
            </label>

            <div className="analyze-field">
              <label className="analyze-field__label">珠子品牌</label>
              <select
                className="analyze-field__select"
                value={brandId}
                onChange={e => setBrandId(e.target.value as BrandId)}
              >
                {BRAND_OPTIONS.map(b => (
                  <option key={b.id} value={b.id}>{b.name}（{b.description}）</option>
                ))}
              </select>
            </div>

            <div className="analyze-field">
              <label className="analyze-field__label">手动指定行列数（可选）</label>
              <div className="analyze-field__row">
                <input
                  className="analyze-field__input"
                  type="text" inputMode="numeric" pattern="[0-9]*"
                  aria-label="列数（宽）"
                  placeholder="列数（宽）"
                  value={manualCols}
                  onChange={e => setManualCols(e.target.value)}
                />
                <span className="analyze-field__sep">×</span>
                <input
                  className="analyze-field__input"
                  type="text" inputMode="numeric" pattern="[0-9]*"
                  aria-label="行数（高）"
                  placeholder="行数（高）"
                  value={manualRows}
                  onChange={e => setManualRows(e.target.value)}
                />
              </div>
              <p className="analyze-field__sub">每项填 1–{MAX_GRID_SIDE} 的整数；填写的一项固定使用，留空的一项自动检测</p>
            </div>

            <button className="analyze-btn analyze-btn--primary" onClick={handleAnalyze}>
              开始识别
            </button>
          </div>
        </div>
      )}

      {/* ── 识别中 ────────────────────────────────────────────── */}
      {stage === 'analyzing' && (
        <div className="analyze-loading">
          <div className="analyze-loading__spinner" />
          <p className="analyze-loading__text">识别中…</p>
          <div className="analyze-loading__bar-wrap">
            <div className="analyze-loading__bar" style={{ width: `${progress}%` }} />
          </div>
          <p className="analyze-loading__pct">{progress}%</p>
        </div>
      )}

      {/* ── 识别失败 ──────────────────────────────────────────── */}
      {stage === 'error' && (
        <div className="analyze-error">
          <p className="analyze-error__msg">{errorMsg}</p>
          <p className="analyze-error__hint">
            可返回调整行列数或裁剪范围后重试；图片无法读取时，请重新选择图片。
          </p>
          <div className="analyze-error__btns">
            <button className="analyze-btn analyze-btn--secondary" onClick={() => setStage('crop')}>
              返回调整
            </button>
            <button className="analyze-btn analyze-btn--secondary" onClick={handleUpload}>
              重新选图
            </button>
          </div>
        </div>
      )}

      {/* ── 识别结果 ──────────────────────────────────────────── */}
      {stage === 'done' && result && (
        <div className="analyze-result">
          <div className="analyze-result__top">
            <p className="analyze-result__meta">
              {result.cols} × {result.rows} 格 · {result.entries.length} 种颜色
            </p>
          </div>

          {result.detectedCrop && (
            <p className="analyze-field__sub" role="status">已自动定位网格区域。请核对预览和行列数；如有偏差，可点击“重新识别”调整范围。</p>
          )}

          {result.entries.length === 0 && (
            <p className="analyze-result__meta" role="status">当前识别范围没有需要放珠子的格子，透明区域已保留为空格。</p>
          )}

          <div className="analyze-result__body">
            {/* 图纸预览 */}
            <div className="analyze-preview">
              <canvas ref={previewCanvasRef} className="analyze-preview__canvas" />
            </div>

            {/* 颜色清单 */}
            <div className="analyze-table-wrap">
              <ColorTable
                entries={result.entries}
                patternName={patternName}
                onExport={handleExport}
              />
            </div>
          </div>

          <div className="analyze-result__actions">
            <button className="analyze-btn analyze-btn--secondary" disabled={openingEditor} onClick={() => setStage('crop')}>
              重新识别
            </button>
            <button className="analyze-btn analyze-btn--primary" disabled={openingEditor} aria-busy={openingEditor} onClick={handleOpenEditor}>
              {openingEditor ? '正在保存并打开…' : '在编辑器中打开'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
