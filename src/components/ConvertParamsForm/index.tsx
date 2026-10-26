import { BRAND_OPTIONS } from '../../utils/palette'
import { MAX_GRID_SIDE } from '../../utils/patternLimits'
import { ALGORITHM_LABELS } from '../../utils/conversionSettings'
import Button from '../Button'
import type { BrandId, ConversionAlgorithm } from '../../types'

/**
 * 转换参数表单 —— 常用项（品牌 / 格数 / 风格 / 颜色精简）在前，算法与其余选项折叠在「高级设置」。
 * 三处复用：编辑器 params 阶段页、重新生成 sheet、ColorPanel 调参标签。
 * 提交按钮由各调用方自行渲染（布局不同：固定 footer / 内联），
 * 样式类（params-section 等）定义在 pages/editor/index.scss，为全局类名。
 */
export interface ConvertParamsFormProps {
  algorithm: ConversionAlgorithm
  setAlgorithm: (value: ConversionAlgorithm) => void
  subjectFocus: boolean
  setSubjectFocus: (value: boolean) => void
  contourEnhance: boolean
  setContourEnhance: (value: boolean) => void
  onCompare: () => void
  brandId:           BrandId
  setBrandId:        (v: BrandId) => void
  gridWidth:         number
  setGridWidth:      (v: number) => void
  mergeThreshold:    number
  setMergeThreshold: (v: number) => void
  mode:              'dominant' | 'average'
  setMode:           (m: 'dominant' | 'average') => void
  dithering:         boolean
  setDithering:      (v: boolean) => void
  /** 如 "60×45 格 · 2700 粒 · 15.6×11.7 cm" */
  sizeLabel:         string
  /** label htmlFor 前缀，避免同页多个表单 id 冲突 */
  idPrefix:          string
}

export default function ConvertParamsForm({
  algorithm, setAlgorithm, onCompare,
  subjectFocus, setSubjectFocus,
  contourEnhance, setContourEnhance,
  brandId, setBrandId,
  gridWidth, setGridWidth,
  mergeThreshold, setMergeThreshold,
  mode, setMode,
  dithering, setDithering,
  sizeLabel, idPrefix,
}: ConvertParamsFormProps) {
  return (
    <>
      <div className="params-section">
        <label className="params-label" htmlFor={`${idPrefix}-brand-select`}>珠子品牌</label>
        <select
          id={`${idPrefix}-brand-select`}
          className="params-brand-select"
          value={brandId}
          onChange={event => setBrandId(event.target.value as BrandId)}
        >
          {BRAND_OPTIONS.map(option => (
            <option key={option.id} value={option.id}>
              {option.name}（{option.description}）
            </option>
          ))}
        </select>
      </div>

      <div className="params-section">
        <div className="params-row">
          <span>
            <span className="params-label">横向格数</span>
            <span className="params-hint-inline">格数越多细节越多，成品也越大（10-{MAX_GRID_SIDE}）</span>
          </span>
          <div className="params-size-input-wrap">
            <input
              className="params-size-input"
              type="number"
              value={gridWidth}
              onChange={e => {
                const v = parseInt(e.target.value, 10)
                if (!isNaN(v)) setGridWidth(Math.min(MAX_GRID_SIDE, Math.max(10, v)))
              }}
            />
          </div>
        </div>
        <input
          className="params-slider"
          type="range"
          min={10}
          max={MAX_GRID_SIDE}
          step={1}
          value={gridWidth}
          onChange={e => setGridWidth(parseInt(e.target.value))}
        />
        <div className="params-row params-row--sub">
          <span className="params-hint">10</span>
          <span className="params-hint">{MAX_GRID_SIDE}</span>
        </div>
      </div>

      <div className="params-section">
        <div className="params-row">
          <span className="params-label">画面风格</span>
          <div className="params-mode-tabs">
            <Button
              className={`params-mode-tab ${mode === 'dominant' ? 'params-mode-tab--active' : ''}`}
              aria-pressed={mode === 'dominant'}
              onClick={() => setMode('dominant')}
            >
              <span className="params-mode-tab__text">卡通（主色）</span>
            </Button>
            <Button
              className={`params-mode-tab ${mode === 'average' ? 'params-mode-tab--active' : ''}`}
              aria-pressed={mode === 'average'}
              onClick={() => setMode('average')}
            >
              <span className="params-mode-tab__text">写实（均值）</span>
            </Button>
          </div>
        </div>
      </div>

      <div className="params-section">
        <div className="params-row">
          <span>
            <span className="params-label">颜色精简</span>
            <span className="params-hint-inline">数值越大，相近颜色合并得越多，用色越少（0-100）</span>
          </span>
          <div className="params-size-input-wrap">
            <Button
              className="params-stepper-btn"
              aria-label="减小阈值"
              onClick={() => setMergeThreshold(Math.max(0, mergeThreshold - 1))}
            >
              <span className="params-stepper-text">-</span>
            </Button>
            <input
              className="params-size-input params-size-input--narrow"
              type="number"
              value={mergeThreshold}
              onChange={e => {
                const v = parseInt(e.target.value, 10)
                if (!isNaN(v)) setMergeThreshold(Math.min(100, Math.max(0, v)))
              }}
            />
            <Button
              className="params-stepper-btn"
              aria-label="增大阈值"
              onClick={() => setMergeThreshold(Math.min(100, mergeThreshold + 1))}
            >
              <span className="params-stepper-text">+</span>
            </Button>
          </div>
        </div>
        <input
          className="params-slider"
          type="range"
          min={0}
          max={100}
          step={1}
          value={mergeThreshold}
          aria-label="颜色精简"
          onChange={e => setMergeThreshold(parseInt(e.target.value))}
        />
      </div>

      <div className="params-info">
        <span className="params-info__text">{sizeLabel}</span>
        <Button className="params-mode-tab" onClick={onCompare}>对比两种算法</Button>
      </div>

      <details className="params-advanced">
        <summary className="params-advanced__summary">高级设置</summary>
        <div className="params-section">
          <label className="params-label" htmlFor={`${idPrefix}-algorithm`}>转换算法</label>
          <select id={`${idPrefix}-algorithm`} className="params-brand-select" value={algorithm}
            onChange={e => setAlgorithm(e.target.value as ConversionAlgorithm)}>
            <option value="legacy">{ALGORITHM_LABELS.legacy}</option>
            <option value="perceptual-v1">{ALGORITHM_LABELS['perceptual-v1']}</option>
          </select>
          <span className="params-hint-inline">经典模式沿用原算法；保真模式尝试改善配色与细节，并非每张图都更好。首次默认经典，之后记住上次采用的模式。</span>
        </div>

        {algorithm === 'perceptual-v1' && mode === 'dominant' && <div className="params-section">
          <Button className="params-row params-toggle-row" aria-label="轮廓增强" aria-pressed={contourEnhance}
            onClick={() => setContourEnhance(!contourEnhance)}>
            <span>
              <span className="params-label">轮廓增强</span>
              <span className="params-hint-inline">保留深色细线与五官，可能加粗描边；关闭时使用原保真效果</span>
            </span>
            <span className={`params-toggle ${contourEnhance ? 'params-toggle--on' : ''}`}><span className="params-toggle__knob" /></span>
          </Button>
          {contourEnhance && gridWidth < 80 && <div className="params-row">
            <span className="params-hint-inline">细节仍不足时可试用 80 格宽，用珠量会增加。</span>
            <Button className="params-mode-tab" onClick={() => setGridWidth(80)}>试用 80 格</Button>
          </div>}
        </div>}

        {algorithm === 'perceptual-v1' && <div className="params-section">
          <span className="params-label">取景设置</span>
          <label className="params-hint-inline">
            <input type="checkbox" checked={subjectFocus} onChange={e => setSubjectFocus(e.target.checked)} />
            主体优先：自动收紧留白（可能排除文字或配角，请核对预览；不确定时保留原构图）
          </label>
        </div>}

        <div className="params-section">
          <Button
            className="params-row params-toggle-row"
            aria-pressed={dithering}
            onClick={() => setDithering(!dithering)}
          >
            <span>
              <span className="params-label">误差扩散抖动</span>
              <span className="params-hint-inline">开启后渐变更自然，但有颗粒感</span>
            </span>
            <span className={`params-toggle ${dithering ? 'params-toggle--on' : ''}`}>
              <span className="params-toggle__knob" />
            </span>
          </Button>
        </div>
      </details>
    </>
  )
}
