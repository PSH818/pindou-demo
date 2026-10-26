import { useState } from 'react'
import { usePatternStore } from '../../store/patternStore'
import Button from '../Button'
import ConvertParamsForm, { type ConvertParamsFormProps } from '../ConvertParamsForm'
import { TRANSPARENT, type BeadColor } from '../../types'
import './index.scss'

export type ParamsTabProps = Omit<ConvertParamsFormProps, 'idPrefix'> & {
  onReconvert: () => void
}

interface Props {
  brandColors: BeadColor[]
  paramsTab?:  ParamsTabProps
}

export default function ColorPanel({ brandColors, paramsTab }: Props) {
  const [tab, setTab] = useState<'palette' | 'params'>('palette')

  const pattern           = usePatternStore(s => s.pattern)
  const selectedColorIdx  = usePatternStore(s => s.selectedColorIdx)
  const highlightColorIdx = usePatternStore(s => s.highlightColorIdx)
  const setSelectedColor  = usePatternStore(s => s.setSelectedColor)
  const setHighlightColor = usePatternStore(s => s.setHighlightColor)

  if (!pattern) return null

  const colorById = new Map(brandColors.map(c => [c.id, c]))

  const countMap = new Map<number, number>()
  for (const idx of pattern.grid) {
    if (idx === TRANSPARENT) continue
    countMap.set(idx, (countMap.get(idx) ?? 0) + 1)
  }

  const usedIndices = pattern.paletteUsed.flatMap((id, idx) =>
    colorById.has(id) && (countMap.get(idx) ?? 0) > 0 ? [idx] : [])
  const highlighted = highlightColorIdx === null ? undefined : colorById.get(pattern.paletteUsed[highlightColorIdx])
  const isHighlightMode = highlightColorIdx !== null
  const enterHighlight = () => {
    setHighlightColor(usedIndices.includes(selectedColorIdx) ? selectedColorIdx : usedIndices[0] ?? null)
  }
  const stepHighlight = (direction: number) => {
    if (!usedIndices.length) return
    const current = usedIndices.indexOf(highlightColorIdx ?? -1)
    const next = current < 0 ? 0 : (current + direction + usedIndices.length) % usedIndices.length
    setHighlightColor(usedIndices[next])
  }

  // 右键快捷进入/退出高亮，与顶部模式切换保持一致。
  const handleContextMenu = (e: React.MouseEvent, idx: number) => {
    e.preventDefault()
    if (!countMap.get(idx) && highlightColorIdx !== idx) return
    setHighlightColor(highlightColorIdx === idx ? null : idx)
  }

  return (
    <div className="color-panel">
      {/* Tab bar — only rendered when params tab is available; hidden on mobile via CSS */}
      {paramsTab && (
        <div className="cp-tabs">
          <Button
            className={`cp-tab ${tab === 'palette' ? 'cp-tab--active' : ''}`}
            aria-pressed={tab === 'palette'}
            onClick={() => setTab('palette')}
          >
            用色
          </Button>
          <Button
            className={`cp-tab ${tab === 'params' ? 'cp-tab--active' : ''}`}
            aria-pressed={tab === 'params'}
            onClick={() => setTab('params')}
          >
            调参
          </Button>
        </div>
      )}

      {/* Palette content */}
      {(!paramsTab || tab === 'palette') && (
        <>
        <div className="color-highlight" aria-label="颜色高亮">
          <div className="color-highlight__modes" role="group" aria-label="色板用途">
            <Button aria-pressed={!isHighlightMode} onClick={() => setHighlightColor(null)}>选色绘制</Button>
            <Button aria-pressed={isHighlightMode} disabled={!usedIndices.length && !isHighlightMode} onClick={() => { if (!isHighlightMode) enterHighlight() }}>同色高亮</Button>
          </div>
          {highlighted ? (
            <>
              <div className="color-highlight__status" role="status">
                <span className="color-highlight__dot" style={{ backgroundColor: `rgb(${highlighted.rgb.join(',')})` }} />
                <span>高亮 {highlighted.code} · {countMap.get(highlightColorIdx!) ?? 0} 粒</span>
              </div>
              <div className="color-highlight__actions">
                <Button onClick={() => stepHighlight(-1)} disabled={usedIndices.length < 2}>上一色</Button>
                <Button onClick={() => stepHighlight(1)} disabled={usedIndices.length < 2}>下一色</Button>
                <Button onClick={() => setHighlightColor(null)}>退出高亮</Button>
              </div>
              <p className="color-highlight__hint">点色卡切换高亮；不切换画笔，也不锁定编辑</p>
            </>
          ) : null}
        </div>
        <div className="color-panel__scroll">
          <div className="color-panel__inner">
            {pattern.paletteUsed.map((colorId, idx) => {
              const color = colorById.get(colorId)
              if (!color) return null
              const [r, g, b] = color.rgb
              const isSelected  = idx === selectedColorIdx
              const isHighlight = idx === highlightColorIdx
              const count = countMap.get(idx) ?? 0

              return (
              <Button
                key={colorId}
                className={[
                  'color-swatch',
                  !isHighlightMode && isSelected ? 'color-swatch--selected' : '',
                  isHighlight ? 'color-swatch--highlight' : '',
                  ].join(' ')}
                aria-pressed={isHighlightMode ? isHighlight : isSelected}
                aria-label={`颜色 ${color.code}`}
                disabled={isHighlightMode && count === 0 && !isHighlight}
                onClick={() => isHighlightMode ? setHighlightColor(idx) : setSelectedColor(idx)}
                onContextMenu={(e) => handleContextMenu(e, idx)}
              >
                <span
                  className="color-swatch__dot"
                  style={{ backgroundColor: `rgb(${r},${g},${b})` }}
                />
                  <span className="color-swatch__code">{color.code}</span>
                  {count > 0 && (
                    <span className="color-swatch__count">{count}</span>
                  )}
              </Button>
              )
            })}
          </div>
        </div>
        </>
      )}

      {/* Params tab content — desktop only via CSS */}
      {paramsTab && tab === 'params' && (
        <div className="cp-params">
          <ConvertParamsForm {...paramsTab} idPrefix="sidebar" />

          <Button className="params-convert-btn" onClick={paramsTab.onReconvert}>
            <span className="params-convert-btn__text">重新生成</span>
          </Button>
        </div>
      )}
    </div>
  )
}
