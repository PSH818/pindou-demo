import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { nanoid } from 'nanoid/non-secure'
import { usePatternStore } from '../../store/patternStore'
import Button from '../../components/Button'
import { savePattern } from '../../utils/storage'
import { BRAND_OPTIONS } from '../../utils/palette'
import { showToast } from '../../utils/webUtils'
import { TRANSPARENT, type Pattern, type BrandId } from '../../types'
import './index.scss'

const PRESETS = [
  { w: 16, h: 16, label: '16×16', sub: '迷你' },
  { w: 29, h: 29, label: '29×29', sub: '小图' },
  { w: 48, h: 48, label: '48×48', sub: '中图' },
  { w: 80, h: 80, label: '80×80', sub: '大图' },
] as const

type Preset = typeof PRESETS[number]

export default function CanvasSetupPage() {
  const navigate = useNavigate()
  const [preset, setPreset]     = useState<Preset | 'custom'>(PRESETS[1])
  const [customW, setCustomW]   = useState(40)
  const [customH, setCustomH]   = useState(40)
  const [brandId, setBrandId]   = useState<BrandId>('mard')
  const [creating, setCreating] = useState(false)

  const setPattern = usePatternStore(s => s.setPattern)

  const width  = preset === 'custom' ? customW : (preset as Preset).w
  const height = preset === 'custom' ? customH : (preset as Preset).h

  const handleStart = useCallback(async () => {
    if (creating) return
    setCreating(true)
    try {
      const pattern: Pattern = {
        id: nanoid(8),
        name: '手绘画板',
        width,
        height,
        brandId,
        paletteUsed: [],
        grid: new Uint16Array(width * height).fill(TRANSPARENT),
        thumbnail: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      await savePattern(pattern)
      setPattern(pattern)
      navigate(`/editor?mode=draw&patternId=${pattern.id}`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '创建画板失败')
    } finally {
      setCreating(false)
    }
  }, [creating, width, height, brandId, setPattern, navigate])

  return (
    <div className="setup-page">
      <div className="setup-topbar">
        <Button className="setup-topbar__back" onClick={() => navigate(-1)}>
          <span className="setup-topbar__back-text">‹ 返回</span>
        </Button>
        <span className="setup-topbar__title">新建画板</span>
        <div style={{ width: '60px' }} />
      </div>

      <div className="setup-body">
        <div className="setup-section">
          <span className="setup-section__title">画板尺寸</span>
          <div className="setup-presets">
            {PRESETS.map(p => (
              <Button
                key={p.label}
                className={`setup-preset${preset === p ? ' setup-preset--active' : ''}`}
                aria-pressed={preset === p}
                onClick={() => setPreset(p)}
              >
                <span className="setup-preset__label">{p.label}</span>
                <span className="setup-preset__sub">{p.sub}</span>
              </Button>
            ))}
            <Button
              className={`setup-preset${preset === 'custom' ? ' setup-preset--active' : ''}`}
              aria-pressed={preset === 'custom'}
              onClick={() => setPreset('custom')}
            >
              <span className="setup-preset__label">自定义</span>
              <span className="setup-preset__sub">W×H</span>
            </Button>
          </div>

          {preset === 'custom' && (
            <div className="setup-custom-size">
              <div className="setup-custom-input-wrap">
                <span className="setup-custom-label">宽</span>
                <input
                  className="setup-custom-input"
                  type="number"
                  defaultValue={customW}
                  onBlur={e => {
                    const v = parseInt(e.target.value, 10)
                    if (!isNaN(v)) setCustomW(Math.min(200, Math.max(8, v)))
                  }}
                />
              </div>
              <span className="setup-custom-x">×</span>
              <div className="setup-custom-input-wrap">
                <span className="setup-custom-label">高</span>
                <input
                  className="setup-custom-input"
                  type="number"
                  defaultValue={customH}
                  onBlur={e => {
                    const v = parseInt(e.target.value, 10)
                    if (!isNaN(v)) setCustomH(Math.min(200, Math.max(8, v)))
                  }}
                />
              </div>
            </div>
          )}

          <span className="setup-size-hint">
            {width}×{height} 格 · 共 {width * height} 粒
          </span>
        </div>

        <div className="setup-section">
          <span className="setup-section__title">珠子品牌</span>
          <div className="setup-brands">
            {BRAND_OPTIONS.map(b => (
              <Button
                key={b.id}
                className={`setup-brand${brandId === b.id ? ' setup-brand--active' : ''}`}
                aria-pressed={brandId === b.id}
                onClick={() => setBrandId(b.id)}
              >
                <span className="setup-brand__name">{b.name}</span>
                <span className="setup-brand__desc">{b.description}</span>
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="setup-footer">
        <Button
          className={`setup-start-btn${creating ? ' setup-start-btn--loading' : ''}`}
          disabled={creating}
          onClick={handleStart}
        >
          <span className="setup-start-btn__text">
            {creating ? '创建中…' : '开始创作'}
          </span>
        </Button>
      </div>
    </div>
  )
}
