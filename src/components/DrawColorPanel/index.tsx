import { useMemo } from 'react'
import Button from '../Button'
import type { BeadColor } from '../../types'
import './index.scss'

interface DrawColorPanelProps {
  brandColors: BeadColor[]
  paletteUsed: number[]
  selectedColorId?: number
  onSelectColor: (colorId: number) => void
}

export default function DrawColorPanel({
  brandColors,
  paletteUsed,
  selectedColorId,
  onSelectColor,
}: DrawColorPanelProps) {
  const usedColors = useMemo(
    () => paletteUsed.flatMap(id => {
      const c = brandColors.find(b => b.id === id)
      return c ? [c] : []
    }),
    [paletteUsed, brandColors]
  )

  return (
    <div className="draw-panel">
      <div className="draw-panel__used-row" style={{ overflowX: 'auto' }}>
        <div className="draw-panel__used-inner">
          <span className="draw-panel__used-label">已用</span>
          {usedColors.length === 0 ? (
            <span className="draw-panel__used-empty">从下方选色开始绘制</span>
          ) : (
            usedColors.map(c => (
              <Button
                key={c.id}
                className={`draw-panel__used-swatch${c.id === selectedColorId ? ' draw-panel__used-swatch--sel' : ''}`}
                style={{ backgroundColor: `rgb(${c.rgb[0]},${c.rgb[1]},${c.rgb[2]})` }}
                aria-label={`已用颜色 ${c.code}`}
                onClick={() => onSelectColor(c.id)}
              />
            ))
          )}
        </div>
      </div>

      <div className="draw-panel__grid-scroll" style={{ overflowY: 'auto' }}>
        <div className="draw-panel__grid">
          {brandColors.map(c => (
            <Button
              key={c.id}
              className={`draw-panel__swatch${c.id === selectedColorId ? ' draw-panel__swatch--sel' : ''}`}
              style={{ backgroundColor: `rgb(${c.rgb[0]},${c.rgb[1]},${c.rgb[2]})` }}
              aria-label={`颜色 ${c.code}`}
              onClick={() => onSelectColor(c.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
