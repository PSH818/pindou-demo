import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '../Button'
import { renderFull } from '../PatternCanvas/renderer'
import { getCanvasFromRef } from '../../utils/canvasHelper'
import { materialItems, makingSignature, printPlan, tilePattern } from '../../utils/making'
import { getMakingProgress, saveMakingProgress } from '../../utils/makingStorage'
import { showModal } from '../../utils/webUtils'
import type { Pattern, BeadColor } from '../../types'
import type { MakingProgress, PrintOptions } from '../../types/making'
import './index.scss'

export default function MakingStudio({ pattern: source, colors, onClose }: { pattern: Pattern; colors: BeadColor[]; onClose: () => void }) {
  // This session is a read-only snapshot: editing and making must never share mutable cells.
  const [pattern] = useState(() => ({ ...source, grid: source.grid.slice(), paletteUsed: [...source.paletteUsed] }))
  const signature = useMemo(() => makingSignature(pattern), [pattern])
  const summary = useMemo(() => { try { return { items: materialItems(pattern, colors), error: '' } } catch (e) { return { items: [], error: (e as Error).message } } }, [pattern, colors])
  const items = summary.items, total = items.reduce((s, i) => s + i.count, 0)
  const [selected, setSelected] = useState<number | null>(null), [tab, setTab] = useState<'make' | 'print'>('make')
  const [record, setRecord] = useState<MakingProgress | null>(null), [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false), [retry, setRetry] = useState(0), [pdfProgress, setPdfProgress] = useState('')
  const lock = useRef(false), alive = useRef(true), canvasRef = useRef<HTMLCanvasElement>(null)
  const [columns, setColumns] = useState('29'), [rows, setRows] = useState('29'), [tileIndex, setTileIndex] = useState(-1)
  const [fit, setFit] = useState(true), [codes, setCodes] = useState(true)
  const stale = !!record && record.signature !== signature
  const completed = new Set(stale ? [] : record?.completedColorIds ?? [])
  const done = items.reduce((s, c) => s + (completed.has(c.colorId) ? c.count : 0), 0)
  const active = items.find(c => c.colorId === selected)
  const plan = useMemo(() => {
    try {
      if (!/^\d+$/.test(columns) || !/^\d+$/.test(rows)) throw new Error('请填写珠板行列数，只接受 1–200 的整数')
      const options: PrintOptions = { mode: 'boards', columns: Number(columns), rows: Number(rows) }
      return { value: printPlan(pattern, colors, options), options, error: '' }
    } catch (e) { return { value: null, options: null, error: (e as Error).message } }
  }, [pattern, colors, columns, rows])
  const tile = tab === 'print' ? plan.value?.tiles[tileIndex] : undefined
  const preview = useMemo(() => tile ? tilePattern(pattern, tile) : pattern, [pattern, tile])
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let disposed = false; setLoaded(false); setLoadError('')
    getMakingProgress(pattern.id).then(value => { if (!disposed) { setRecord(value); setLoaded(true); setError('') } })
      .catch(e => { if (!disposed) setLoadError(e instanceof Error ? e.message : '制作进度读取失败') })
    return () => { disposed = true }
  }, [pattern.id, retry])
  useEffect(() => {
    const target = getCanvasFromRef(canvasRef); if (!target || summary.error) return
    const { canvas, ctx } = target, scale = 20
    canvas.width = preview.width * scale; canvas.height = preview.height * scale
    renderFull(ctx, canvas.width, canvas.height, preview, colors, { scale, offsetX: 0, offsetY: 0, showGrid: true, showColorCode: codes, circular: false, highlightColorIdx: selected === null ? null : pattern.paletteUsed.indexOf(selected), showGuideLines: true, guideLinesEvery: 5, guideLinesColor: '#bd6959' })
  }, [preview, colors, selected, codes, summary.error, pattern.paletteUsed])
  async function persist(ids: number[]) {
    if (lock.current || !loaded || summary.error) return false
    lock.current = true; setBusy(true); setError('')
    try {
      const next: MakingProgress = { version: 1, patternId: pattern.id, signature, revision: (record?.revision ?? 0) + 1, completedColorIds: ids, updatedAt: Date.now() }
      await saveMakingProgress(next, record?.revision ?? 0)
      if (alive.current) { setRecord(next); setNotice('制作进度已保存到本机') }
      return true
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '保存失败，标记尚未保存，请重试'); return false }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  async function toggle(id: number, advance = false) {
    if (stale || lock.current) return
    const ids = new Set(completed)
    if (advance || !ids.has(id)) ids.add(id); else ids.delete(id)
    if (await persist([...ids])) if (advance && alive.current) setSelected(items.find(i => !ids.has(i.colorId))?.colorId ?? null)
  }
  async function reset() {
    if (lock.current || !loaded) return
    if (await showModal({ title: '重新开始制作？', content: '仅清除本图纸的制作标记，不改动图纸。图纸内容有变化时，会以当前打开的图纸重新记录。' })) await persist([])
  }
  async function download(mode: 'whole' | 'boards') {
    if (lock.current || summary.error || (mode === 'boards' && !plan.options)) return
    lock.current = true; setBusy(true); setError(''); setPdfProgress('正在准备 PDF…')
    try {
      const { exportPatternToPDF } = await import('../../utils/exportPDF')
      await exportPatternToPDF(pattern, colors, mode === 'boards' ? plan.options! : { mode: 'whole', columns: 29, rows: 29 }, (n, total) => { if (alive.current) setPdfProgress(`正在生成 ${n} / ${total} 页`) })
      if (alive.current) setNotice('PDF 已生成并请求下载；包含完整图纸，不受高亮或制作标记影响')
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'PDF 导出失败') }
    finally { lock.current = false; if (alive.current) { setBusy(false); setPdfProgress('') } }
  }
  return <div className="making-studio">
    <header><Button disabled={busy} onClick={onClose}>‹ 返回编辑</Button><h1>制作图纸</h1><span>{pattern.name}</span></header>
    <main>
      <section className="making-studio__preview" aria-label="只读制作视图">
        <div className="making-studio__view-tools"><Button aria-pressed={fit} onClick={() => setFit(v => !v)}>{fit ? '放大看格子' : '适合屏幕'}</Button><Button aria-pressed={codes} onClick={() => setCodes(v => !v)}>显示色号</Button><Button disabled={selected === null} onClick={() => setSelected(null)}>显示全部颜色</Button></div>
        <p>{active ? `正在高亮 ${active.code} · 全图 ${active.count} 粒` : '显示全部颜色'}{tile ? ` · 珠板 ${tile.row}-${tile.column}，原图第 ${tile.y + 1}–${tile.y + tile.height} 行 / 第 ${tile.x + 1}–${tile.x + tile.width} 列` : ` · ${pattern.width} × ${pattern.height} 格`}</p>
        <div className={`making-studio__canvas ${fit ? 'is-fit' : ''}`}><canvas ref={canvasRef} aria-label="制作图纸预览" /></div>
        <p>只读视图，不会画错格子。放大后可滚动查看；透明格不放珠。</p>
      </section>
      <section className="making-studio__panel">
        <nav aria-label="制作工具"><Button aria-pressed={tab === 'make'} onClick={() => setTab('make')}>逐色制作</Button><Button aria-pressed={tab === 'print'} onClick={() => setTab('print')}>分块打印</Button></nav>
        <div hidden={tab !== 'make'}>
          <h2>用料与进度</h2><p aria-live="polite">已完成 {done} / {total} 粒 · {items.filter(i => completed.has(i.colorId)).length} / {items.length} 色</p>
          <progress value={done} max={Math.max(1, total)} aria-label="制作完成进度" />
          <p>按整种颜色标记完成，不代表逐格核验。点色号高亮，勾选记进度。</p>
          {stale && <div role="alert" className="making-studio__warning">图纸内容与上次制作不同，旧标记暂不套用。请确认当前图纸后重新开始制作。</div>}
          <div className="making-studio__color-actions"><Button disabled={busy || !loaded || stale || !active || completed.has(active.colorId)} onClick={() => active && void toggle(active.colorId, true)}>完成此色，下一色</Button><Button disabled={busy || !loaded || !record} onClick={reset}>重新开始制作</Button></div>
          <div className="making-studio__materials">{items.map(item => <div key={item.colorId} className={completed.has(item.colorId) ? 'is-done' : ''}>
            <Button aria-label={`高亮 ${item.code}`} aria-pressed={selected === item.colorId} onClick={() => setSelected(selected === item.colorId ? null : item.colorId)}><span className="making-studio__swatch" style={{ background: `rgb(${item.rgb.join(',')})` }} /><strong>{item.code}</strong><span>{item.count} 粒</span></Button>
            <label><input type="checkbox" aria-label={`${item.code} 已完成`} checked={completed.has(item.colorId)} disabled={!loaded || busy || stale} onChange={() => void toggle(item.colorId)} />完成</label>
          </div>)}</div>
          {!items.length && !summary.error && <p>没有需要制作的珠子，图纸全透明。</p>}
          <p>标记单独保存在当前浏览器；不修改颜色、图纸或用料数量。编辑图纸后需重新核对进度。</p>
        </div>
        <div hidden={tab !== 'print'}>
          <h2>按实际珠板分块</h2><p>以左上角为起点，不补格、不丢格。每块一页，含原图行列范围及相邻块编号。</p>
          <div className="making-studio__sizes"><label>珠板列数<input aria-label="打印珠板列数" inputMode="numeric" value={columns} onChange={e => { setColumns(e.target.value); setTileIndex(-1) }} /></label><label>珠板行数<input aria-label="打印珠板行数" inputMode="numeric" value={rows} onChange={e => { setRows(e.target.value); setTileIndex(-1) }} /></label></div>
          {plan.error ? <p role="alert">{plan.error}</p> : <><p>{plan.value!.tiles.length} 块珠板 · PDF 共 {plan.value!.pageCount} 页（总览 + 分块 + 完整用料清单）</p>
            <label>查看分块<select aria-label="查看打印分块" value={tileIndex} onChange={e => setTileIndex(Number(e.target.value))}><option value={-1}>完整图纸</option>{plan.value!.tiles.map(t => <option key={t.index} value={t.index}>珠板 {t.row}-{t.column} · {t.width}×{t.height} 格</option>)}</select></label></>}
          <p className="making-studio__warning">PDF 为适合 A4 纸张的阅读缩放，不是实物 1:1 垫图。按全局行列坐标拼接，不要按纸边对齐；各块不会镜像或旋转。珠板过大时格内色号不显示，可减小分块规格。</p>
          <Button className="making-studio__primary" disabled={busy || !!summary.error || !plan.value} onClick={() => void download('boards')}>下载分块 PDF</Button>
          <Button disabled={busy || !!summary.error} onClick={() => void download('whole')}>下载完整图纸 PDF</Button>
        </div>
        <div className="making-studio__status" role="status">{pdfProgress || (busy ? '正在保存进度…' : notice || (!loaded && !loadError ? '正在读取制作进度…' : ''))}</div>
        {(error || loadError || summary.error) && <p role="alert">{error || loadError || summary.error}</p>}
        {(error || loadError) && <Button disabled={busy} onClick={() => setRetry(v => v + 1)}>重新读取进度</Button>}
      </section>
    </main>
  </div>
}
