import { useRef } from 'react'
import Button from '../Button'
import type { PatternMeta } from '../../types'
import { ALGORITHM_LABELS } from '../../utils/conversionSettings'
import './index.scss'

interface Props {
  pattern: PatternMeta
  onTap: () => void
  onLongPress: () => void
  managing?: boolean
  selected?: boolean
  onSelect?: () => void
}

function formatTime(ts: number): string {
  const s = (Date.now() - ts) / 1000
  if (s < 60)     return '刚刚'
  if (s < 3600)   return `${Math.floor(s / 60)}分钟前`
  if (s < 86400)  return `${Math.floor(s / 3600)}小时前`
  if (s < 604800) return `${Math.floor(s / 86400)}天前`
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export default function PatternCard({
  pattern, onTap, onLongPress,
  managing = false, selected = false, onSelect,
}: Props) {
  const { name, width, height, thumbnail, updatedAt } = pattern
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handlePointerDown = () => {
    if (managing) return
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null
      onLongPress()
    }, 500)
  }

  const handlePointerUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const handleClick = () => {
    if (managing) {
      onSelect?.()
    } else {
      onTap()
    }
  }

  // 桌面端右键 = 移动端长按（重命名 / 删除菜单）
  const handleContextMenu = (e: React.MouseEvent) => {
    if (managing) return
    e.preventDefault()
    onLongPress()
  }

  return (
    <Button
      className={`pattern-card${selected ? ' pattern-card--selected' : ''}`}
      aria-pressed={managing ? selected : undefined}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <span className="pattern-card__thumb">
        {thumbnail ? (
          <img
            className="pattern-card__img"
            src={thumbnail}
            style={{ objectFit: 'cover' }}
            loading="lazy"
            alt={name}
          />
        ) : (
          <span className="pattern-card__placeholder">
            {Array.from({ length: 64 }).map((_, i) => (
              <span
                key={i}
                className="pattern-card__bead"
                style={{ background: PLACEHOLDER_COLORS[i % PLACEHOLDER_COLORS.length] }}
              />
            ))}
          </span>
        )}
        <span className="pattern-card__size-badge">
          <span className="pattern-card__size-text">{width}×{height}</span>
        </span>
      </span>

      <span className="pattern-card__info">
        <span className="pattern-card__name">{name}</span>
        {pattern.conversionAlgorithm && <span className="pattern-card__time">{ALGORITHM_LABELS[pattern.conversionAlgorithm]}</span>}
        <span className="pattern-card__time">{formatTime(updatedAt)}</span>
      </span>

      {managing && (
        <span className={`pattern-card__select${selected ? ' pattern-card__select--on' : ''}`}>
          {selected && <span className="pattern-card__select-check">✓</span>}
        </span>
      )}
    </Button>
  )
}

const PLACEHOLDER_COLORS = [
  'rgb(220,50,50)',
  'rgb(240,110,30)',
  'rgb(248,210,30)',
  'rgb(80,185,70)',
  'rgb(50,155,230)',
  'rgb(145,55,200)',
  'rgb(240,125,165)',
  'rgb(135,75,40)',
  'rgb(190,190,190)',
  'rgb(255,180,50)',
  'rgb(30,130,180)',
  'rgb(100,200,120)',
  'rgb(200,60,130)',
  'rgb(90,60,160)',
  'rgb(170,90,50)',
  'rgb(220,220,80)',
]
