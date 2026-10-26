import { useEffect, useRef, useState } from 'react'
import { usePatternStore } from '../../store/patternStore'
import Button from '../Button'
import type { EditTool } from '../../types'
import './index.scss'

import brushIcon      from '../../assets/icons/brush.svg'
import eraserIcon     from '../../assets/icons/eraser.svg'
import fillIcon       from '../../assets/icons/fill.svg'
import eyedropperIcon from '../../assets/icons/eyedropper.svg'
import undoIcon       from '../../assets/icons/undo.svg'
import redoIcon       from '../../assets/icons/redo.svg'
import gridlineIcon   from '../../assets/icons/gridline.svg'

const TOOLS: { id: EditTool; label: string; icon: string }[] = [
  { id: 'brush',      label: '画笔', icon: brushIcon },
  { id: 'eraser',     label: '橡皮', icon: eraserIcon },
  { id: 'fill',       label: '填充', icon: fillIcon },
  { id: 'eyedropper', label: '取色', icon: eyedropperIcon },
]

const GUIDE_COLORS: { value: string; label: string }[] = [
  { value: '#e53935', label: '红色' },
  { value: '#000000', label: '黑色' },
  { value: '#808080', label: '灰色' },
  { value: '#ffffff', label: '白色' },
]

interface PopoverPos { left: number; top: number }

export default function ToolBar() {
  const tool               = usePatternStore(s => s.tool)
  const historyIndex       = usePatternStore(s => s.historyIndex)
  const historyLen         = usePatternStore(s => s.history.length)
  const setTool            = usePatternStore(s => s.setTool)
  const undo               = usePatternStore(s => s.undo)
  const redo               = usePatternStore(s => s.redo)
  const showGuideLines     = usePatternStore(s => s.showGuideLines)
  const guideLinesColor    = usePatternStore(s => s.guideLinesColor)
  const setShowGuideLines  = usePatternStore(s => s.setShowGuideLines)
  const setGuideLinesColor = usePatternStore(s => s.setGuideLinesColor)

  const canUndo = historyIndex > 0
  const canRedo = historyIndex < historyLen - 1

  const [popoverOpen, setPopoverOpen] = useState(false)
  const [popoverPos, setPopoverPos]   = useState<PopoverPos>({ left: 0, top: 0 })
  const gridBtnRef = useRef<HTMLButtonElement>(null)

  function openPopover() {
    if (!gridBtnRef.current) return
    const rect = gridBtnRef.current.getBoundingClientRect()
    const isDesktop = window.innerWidth >= 1024
    setPopoverPos(isDesktop
      // 桌面：弹到工具栏右侧，垂直居中对齐按钮
      ? { left: rect.right + 10, top: rect.top + rect.height / 2 }
      // 移动端：弹到工具栏上方，水平居中对齐按钮
      : { left: rect.left + rect.width / 2, top: rect.top - 10 }
    )
    setPopoverOpen(true)
  }

  // 点击外部关闭
  useEffect(() => {
    if (!popoverOpen) return
    function onOutside(e: MouseEvent) {
      const target = e.target as Node
      if (gridBtnRef.current?.contains(target)) return
      const popoverEl = document.querySelector('.toolbar__grid-popover')
      if (popoverEl?.contains(target)) return
      setPopoverOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [popoverOpen])

  function selectColor(color: string) {
    setShowGuideLines(true)
    setGuideLinesColor(color)
  }

  function selectOff() {
    setShowGuideLines(false)
  }

  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024
  const popoverStyle: React.CSSProperties = isDesktop
    ? { position: 'fixed', left: popoverPos.left, top: popoverPos.top, transform: 'translateY(-50%)' }
    : { position: 'fixed', left: popoverPos.left, top: popoverPos.top, transform: 'translateX(-50%) translateY(-100%)' }

  return (
    <div className="toolbar">
      <div className="toolbar__tools">
        {TOOLS.map(t => (
          <Button
            key={t.id}
            className={`toolbar__btn ${tool === t.id ? 'toolbar__btn--active' : ''}`}
            aria-pressed={tool === t.id}
            onClick={() => setTool(t.id)}
          >
            <img className="toolbar__icon-img" src={t.icon} alt={t.label} />
            <span className="toolbar__label">{t.label}</span>
          </Button>
        ))}
      </div>

      <div className="toolbar__divider" />

      <div className="toolbar__actions">
        <Button
          className={`toolbar__btn ${!canUndo ? 'toolbar__btn--disabled' : ''}`}
          disabled={!canUndo}
          onClick={undo}
        >
          <img className="toolbar__icon-img" src={undoIcon} alt="撤销" />
          <span className="toolbar__label">撤销</span>
        </Button>
        <Button
          className={`toolbar__btn ${!canRedo ? 'toolbar__btn--disabled' : ''}`}
          disabled={!canRedo}
          onClick={redo}
        >
          <img className="toolbar__icon-img" src={redoIcon} alt="重做" />
          <span className="toolbar__label">重做</span>
        </Button>
      </div>

      <div className="toolbar__divider" />

      {/* 格线控制 */}
      <Button
        ref={gridBtnRef}
        className={`toolbar__btn ${popoverOpen ? 'toolbar__btn--grid-open' : ''}`}
        aria-label="格线颜色"
        aria-expanded={popoverOpen}
        onClick={() => popoverOpen ? setPopoverOpen(false) : openPopover()}
      >
        <span className="toolbar__grid-icon-wrap">
          <img className="toolbar__icon-img" src={gridlineIcon} alt="" />
          {showGuideLines && (
            <span
              className="toolbar__grid-dot"
              style={{
                background: guideLinesColor,
                outline: guideLinesColor === '#ffffff' ? '1px solid #ccc' : undefined,
              }}
            />
          )}
        </span>
        <span className="toolbar__label">格线</span>
      </Button>

      {/* Popover（fixed，不受 overflow 裁剪） */}
      {popoverOpen && (
        <div className="toolbar__grid-popover" style={popoverStyle} role="dialog" aria-label="格线颜色">
          <span className="toolbar__grid-popover__title">格线颜色</span>
          <div className="toolbar__grid-swatches">
            <button
              type="button"
              className={`toolbar__grid-swatch toolbar__grid-swatch--off ${!showGuideLines ? 'toolbar__grid-swatch--active' : ''}`}
              aria-label="关闭格线"
              title="不显示"
              onClick={selectOff}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
                <line x1="3.5" y1="10.5" x2="10.5" y2="3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            {GUIDE_COLORS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`toolbar__grid-swatch ${showGuideLines && guideLinesColor === value ? 'toolbar__grid-swatch--active' : ''}`}
                style={{ background: value }}
                aria-label={label}
                title={label}
                onClick={() => selectColor(value)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
