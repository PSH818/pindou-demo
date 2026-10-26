import { useEffect, useRef, useState } from 'react'
import type { BeadColor, ConvertParams } from '../../types'
import { loadImageToBuffer } from '../../utils/imageLoader'
import { loadBrand } from '../../utils/palette'
import { ALGORITHM_LABELS, previewImage, previewStats, runPreview, type ConversionPreview } from '../../utils/algorithmComparison'
import Button from '../Button'
import './index.scss'

interface Props {
  imagePath: string
  params: ConvertParams
  onClose: () => void
  onUse: (result: ConversionPreview, colors: BeadColor[], params: ConvertParams) => Promise<void>
  onKeepBoth: (results: ConversionPreview[], colors: BeadColor[], params: ConvertParams) => Promise<void>
}

export default function AlgorithmComparison({ imagePath, params, onClose, onUse, onKeepBoth }: Props) {
  const [settings] = useState(() => ({ ...params }))
  const [results, setResults] = useState<(ConversionPreview & { image: string })[]>([])
  const [colors, setColors] = useState<BeadColor[]>([])
  const [status, setStatus] = useState('读取图片…')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [zoom, setZoom] = useState(1)
  const panes = useRef<(HTMLDivElement | null)[]>([])
  const closeRef = useRef<HTMLButtonElement>(null)
  const savingRef = useRef(false)

  const save = async (action: () => Promise<void>) => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError('')
    try { await action() }
    catch (error) {
      setError(error instanceof Error ? error.message : '保存失败')
      savingRef.current = false
      setSaving(false)
    }
  }

  useEffect(() => { closeRef.current?.focus() }, [])
  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    void (async () => {
      const [image, brand] = await Promise.all([loadImageToBuffer(imagePath, 400), loadBrand(settings.brandId)])
      if (signal.aborted) return
      setColors(brand.colors)
      const previews = []
      for (const algorithm of ['legacy', settings.algorithm === 'cartoon-v1' ? 'cartoon-v1' : 'perceptual-v1'] as const) {
        setStatus(`${ALGORITHM_LABELS[algorithm]}：0%`)
        const result = await runPreview(image, settings, brand.colors, algorithm, signal,
          value => setStatus(`${ALGORITHM_LABELS[algorithm]}：${value}%`))
        if (signal.aborted) return
        previews.push({ ...result, image: previewImage(result, settings.width, settings.height, brand.colors) })
      }
      setResults(previews)
      setStatus('')
    })().catch(error => {
      if (!signal.aborted) { setError(error instanceof Error ? error.message : '对比失败'); setStatus('') }
    })
    return () => controller.abort()
  }, [imagePath, settings])

  return (
    <div className="algorithm-comparison">
      <div className="algorithm-comparison__header">
        <h1>算法对比</h1>
        <Button ref={closeRef} disabled={saving} onClick={onClose}>返回设置</Button>
      </div>
      <p>同一张图片 · {settings.width}×{settings.height} 格 · {settings.mode === 'dominant' ? '卡通主色' : '写实均值'} · 合并 {settings.mergeThreshold} · 抖动{settings.dithering ? '开' : '关'}</p>
      <p>两种算法的合并强度含义不同，先把合并设为 0、关闭抖动，可单独比较采样和选色。</p>
      <p>本次对比经典与保真，保真轮廓增强{settings.algorithm === 'cartoon-v1' ? '开启' : '关闭'}。
        主体优先{settings.subjectFocus ? '已开启，仅保真自动取景，构图不同；请核对文字和配角是否保留' : '未开启，保持同一构图'}。</p>
      <details><summary>查看原图</summary><img className="algorithm-comparison__source" src={imagePath} alt="用于两种算法的相同原图" /></details>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
      {results.length === 2 && <>
        <label className="algorithm-comparison__zoom">同步放大 {zoom} 倍
          <input type="range" min="1" max="4" step="1" value={zoom} onChange={e => setZoom(Number(e.target.value))} />
        </label>
        <div className="algorithm-comparison__results">
          {results.map((result, index) => {
            const stats = previewStats(result.grid, settings.width, settings.height)
            return <section key={result.algorithm}>
              <h2>{ALGORITHM_LABELS[result.algorithm]}</h2>
              <p>{stats.colors} 色 · {stats.beads} 粒 · {stats.isolated} 个孤立格 · {(result.elapsedMs / 1000).toFixed(2)} 秒</p>
              <div className="algorithm-comparison__viewport" style={{ aspectRatio: `${settings.width} / ${settings.height}` }} ref={el => { panes.current[index] = el }} onScroll={e => {
                const other = panes.current[1 - index]
                if (other) { other.scrollLeft = e.currentTarget.scrollLeft; other.scrollTop = e.currentTarget.scrollTop }
              }}>
                <img src={result.image} alt={`${ALGORITHM_LABELS[result.algorithm]}转换结果`} style={{ width: `${zoom * 100}%` }} />
              </div>
              <Button className="algorithm-comparison__use" disabled={saving}
                onClick={() => void save(() => onUse(result, colors, settings))}>采用这张图纸</Button>
            </section>
          })}
        </div>
        <Button className="algorithm-comparison__use" disabled={saving}
          onClick={() => void save(() => onKeepBoth(results, colors, settings))}>两个版本都保留</Button>
        <p>分别新增两张图纸，不覆盖当前图纸；保存后返回“我的图纸”。同时保留不会改变默认模式。</p>
        <p>孤立格也可能是眼睛、高光等细节，不能单凭数量判断好坏。耗时包括 Worker 启动，不含图片读取；预览不会保存，采用或保留后才保存。</p>
      </>}
    </div>
  )
}
