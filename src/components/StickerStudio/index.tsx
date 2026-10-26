import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '../Button'
import { STICKERS } from '../../data/stickers'
import { placeSticker, stickerDefaults, transformSticker } from '../../utils/sticker'
import { getCanvasFromRef } from '../../utils/canvasHelper'
import { renderFull } from '../PatternCanvas/renderer'
import { usePatternStore } from '../../store/patternStore'
import type { BeadColor, Pattern } from '../../types'
import './index.scss'

interface Props { pattern: Pattern; brandColors: BeadColor[]; onClose: () => void }

export default function StickerStudio({ pattern, brandColors, onClose }: Props) {
  const [base] = useState(pattern)
  const [stickerId, setStickerId] = useState(STICKERS[0].id)
  const sticker = STICKERS.find(s => s.id === stickerId)!
  const [turns, setTurns] = useState(0)
  const [flipX, setFlipX] = useState(false)
  const [flipY, setFlipY] = useState(false)
  const [size, setSize] = useState(1)
  const [colors, setColors] = useState(() => stickerDefaults(STICKERS[0], brandColors))
  const pixels = useMemo(() => transformSticker(sticker, turns, flipX, flipY, size), [sticker, turns, flipX, flipY, size])
  const [column, setColumn] = useState(() => String(Math.max(0, Math.floor((base.width - pixels.width) / 2)) + 1))
  const [row, setRow] = useState(() => String(Math.max(0, Math.floor((base.height - pixels.height) / 2)) + 1))
  const [allowOverlap, setAllowOverlap] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState('')
  const [bounds, setBounds] = useState({ width: 300, height: 300 })
  const dialogRef = useRef<HTMLDialogElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const committed = useRef(false)
  const drag = useRef<{ id: number; dx: number; dy: number; column: string; row: string } | null>(null)
  const x = Number(column) - 1, y = Number(row) - 1
  const validPosition = /^\d+$/.test(column) && /^\d+$/.test(row) && Number.isSafeInteger(x) && Number.isSafeInteger(y) && x >= 0 && y >= 0 && x < base.width && y < base.height
  const preview = useMemo(() => placeSticker(base, pixels, colors, validPosition ? x : 0, validPosition ? y : 0), [base, pixels, colors, validPosition, x, y])
  const stale = pattern !== base
  const canApply = validPosition && !preview.outside && !!preview.changed && (!preview.overlap || allowOverlap) && !stale
  const scale = Math.min((bounds.width - 32) / base.width, (bounds.height - 32) / base.height)
  const offsetX = (bounds.width - base.width * scale) / 2, offsetY = (bounds.height - base.height * scale) / 2

  useEffect(() => {
    const dialog = dialogRef.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  useEffect(() => {
    setAllowOverlap(false)
  }, [column, row, pixels, colors])
  useEffect(() => {
    const target = getCanvasFromRef(canvasRef)
    if (!target) return
    const update = () => {
      const rect = target.canvas.getBoundingClientRect()
      setBounds({ width: Math.max(40, rect.width), height: Math.max(40, rect.height) })
    }
    const observer = new ResizeObserver(update)
    observer.observe(target.canvas)
    update()
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const target = getCanvasFromRef(canvasRef)
    if (!target) return
    const { canvas, ctx } = target, dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(bounds.width * dpr)
    canvas.height = Math.round(bounds.height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    renderFull(ctx, bounds.width, bounds.height, { ...base, ...preview }, brandColors, {
      scale, offsetX, offsetY, showGrid: true, circular: false, showColorCode: false, highlightColorIdx: null,
    })
    if (validPosition) {
      ctx.strokeStyle = '#f0874e'
      ctx.lineWidth = 2
      ctx.setLineDash([5, 3])
      ctx.strokeRect(offsetX + x * scale, offsetY + y * scale, pixels.width * scale, pixels.height * scale)
      ctx.setLineDash([])
    }
  }, [base, preview, brandColors, bounds, scale, offsetX, offsetY, validPosition, x, y, pixels])

  function moveTo(nx: number, ny: number) {
    setColumn(String(Math.max(0, Math.min(base.width - 1, nx)) + 1))
    setRow(String(Math.max(0, Math.min(base.height - 1, ny)) + 1))
  }
  function choose(id: string) {
    const next = STICKERS.find(s => s.id === id)!
    setStickerId(id); setTurns(0); setFlipX(false); setFlipY(false); setSize(1)
    setColors(stickerDefaults(next, brandColors))
    moveTo(Math.floor((base.width - next.rows[0].length) / 2), Math.floor((base.height - next.rows.length) / 2))
  }
  function cellAt(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: Math.floor((event.clientX - rect.left - offsetX) / scale), y: Math.floor((event.clientY - rect.top - offsetY) / scale) }
  }
  function finishPointer(event: React.PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(event.pointerId)
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  function commit() {
    if (committed.current || !canApply) return
    const store = usePatternStore.getState()
    if (store.pattern !== base) { setError('图纸已发生变化，请关闭后重新添加贴纸'); return }
    committed.current = true
    store.applyGridAndPalette(preview.grid, preview.paletteUsed)
    onClose()
  }

  return (
    <dialog className="sticker-studio" ref={dialogRef} aria-labelledby="sticker-title" onCancel={e => { e.preventDefault(); onClose() }}>
      <header className="sticker-studio__header">
        <div><h2 id="sticker-title">添加图案贴纸</h2><p>先预览再确认，不满意可随时取消</p></div>
        <Button onClick={onClose} aria-label="关闭贴纸">关闭</Button>
      </header>
      <div className="sticker-studio__body">
        <section className="sticker-studio__preview">
          <div className="sticker-studio__preview-tools">
            <span>单指移贴纸 · 双指移视图</span>
            <label>预览 <select aria-label="预览缩放" value={zoom} onChange={e => setZoom(Number(e.target.value))}><option value={1}>100%</option><option value={2}>200%</option><option value={3}>300%</option></select></label>
          </div>
          <div className="sticker-studio__viewport" ref={viewportRef}>
            <canvas ref={canvasRef} aria-label="贴纸放置预览" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
              onPointerDown={e => {
                if (e.button !== 0) return
                pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
                e.currentTarget.setPointerCapture(e.pointerId)
                if (pointers.current.size > 1) {
                  // 第二指开始平移时，撤回第一指落下造成的临时定位。
                  if (drag.current) { setColumn(drag.current.column); setRow(drag.current.row) }
                  drag.current = null
                  return
                }
                const cell = cellAt(e)
                const inside = validPosition && cell.x >= x && cell.y >= y && cell.x < x + pixels.width && cell.y < y + pixels.height
                drag.current = { id: e.pointerId, dx: inside ? cell.x - x : Math.floor(pixels.width / 2), dy: inside ? cell.y - y : Math.floor(pixels.height / 2), column, row }
                moveTo(cell.x - drag.current.dx, cell.y - drag.current.dy)
              }}
              onPointerMove={e => {
                const previous = pointers.current.get(e.pointerId)
                if (!previous) return
                pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
                if (pointers.current.size > 1 && viewportRef.current) {
                  viewportRef.current.scrollLeft -= (e.clientX - previous.x) / pointers.current.size
                  viewportRef.current.scrollTop -= (e.clientY - previous.y) / pointers.current.size
                } else if (drag.current?.id === e.pointerId) {
                  const cell = cellAt(e); moveTo(cell.x - drag.current.dx, cell.y - drag.current.dy)
                }
              }}
              onPointerUp={finishPointer}
              onPointerCancel={finishPointer}
              onLostPointerCapture={finishPointer}
            />
          </div>
        </section>
        <section className="sticker-studio__settings" aria-label="贴纸设置">
          <div className="sticker-studio__library">
            {STICKERS.map(s => <Button key={s.id} aria-pressed={s.id === stickerId} aria-label={`贴纸 ${s.name}`} onClick={() => choose(s.id)}>
              <span className="sticker-studio__mini" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${s.rows[0].length}, 1fr)`, aspectRatio: `${s.rows[0].length}/${s.rows.length}` }}>
                {s.rows.join('').split('').map((c, i) => <span key={i} style={{ background: c === '.' ? 'transparent' : `rgb(${s.colors[Number(c)].join(',')})` }} />)}
              </span>
              <span>{s.name}</span>
            </Button>)}
          </div>
          <label>尺寸 <select aria-label="贴纸尺寸" value={size} onChange={e => setSize(Number(e.target.value))}>
            {[1, 2, 3].map(n => <option key={n} value={n}>{n} 倍（整数格）</option>)}
          </select><span>{pixels.width} × {pixels.height} 格 · {preview.beads} 粒</span></label>
          <div className="sticker-studio__transforms">
            <Button onClick={() => setTurns(v => (v + 1) % 4)}>旋转 90°</Button>
            <Button aria-pressed={flipX} onClick={() => setFlipX(v => !v)}>水平翻转</Button>
            <Button aria-pressed={flipY} onClick={() => setFlipY(v => !v)}>垂直翻转</Button>
          </div>
          <div className="sticker-studio__position">
            <label>起始列<input aria-label="贴纸起始列" inputMode="numeric" value={column} onChange={e => setColumn(e.target.value)} /></label>
            <label>起始行<input aria-label="贴纸起始行" inputMode="numeric" value={row} onChange={e => setRow(e.target.value)} /></label>
            <Button onClick={() => moveTo(Math.floor((base.width - pixels.width) / 2), Math.floor((base.height - pixels.height) / 2))}>居中</Button>
          </div>
          {colors.map((id, i) => <label key={i}>配色 {i + 1}<select aria-label={`贴纸配色 ${i + 1}`} value={id} onChange={e => setColors(v => v.map((c, j) => i === j ? Number(e.target.value) : c))}>
            {brandColors.map(c => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select><span className="sticker-studio__color" style={{ background: `rgb(${brandColors.find(c => c.id === id)!.rgb.join(',')})` }} /></label>)}
          <div className="sticker-studio__notice" role="status">
            {!validPosition ? '请填写图纸范围内的整数行列（从 1 开始）' : preview.outside ? `${preview.outside} 粒超出图纸，请移动或缩小贴纸` : preview.overlap ? `将覆盖 ${preview.overlap} 格已有珠子` : '当前位置没有覆盖已有珠子'}
          </div>
          {preview.overlap > 0 && <label className="sticker-studio__consent"><input type="checkbox" checked={allowOverlap} onChange={e => setAllowOverlap(e.target.checked)} />允许覆盖这些格子（可撤销）</label>}
          <p>确认前只是预览；确认后合入图纸，可一步撤销。独立小图案不会自动连接主体，请自行检查连接处。</p>
          {(stale || error) && <p role="alert">{error || '图纸已变化，请关闭后重新添加贴纸'}</p>}
        </section>
      </div>
      <footer className="sticker-studio__footer"><Button onClick={onClose}>取消</Button><Button className="sticker-studio__confirm" disabled={!canApply} onClick={commit}>确认放置</Button></footer>
    </dialog>
  )
}
