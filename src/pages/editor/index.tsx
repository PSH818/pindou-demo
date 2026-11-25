import { useState, useEffect, useCallback, useRef } from 'react'
import { nanoid } from 'nanoid/non-secure'
import { useNavigate, useSearchParams } from 'react-router-dom'
import closeIcon from '../../assets/icons/close.svg'
import { exportPatternToPNG } from '../../utils/export'
import PatternCanvas from '../../components/PatternCanvas'
import ToolBar from '../../components/ToolBar'
import Button from '../../components/Button'
import ColorPanel, { type ParamsTabProps } from '../../components/ColorPanel'
import ConvertParamsForm from '../../components/ConvertParamsForm'
import AlgorithmComparison from '../../components/AlgorithmComparison'
import type { ConversionPreview } from '../../utils/algorithmComparison'
import DrawColorPanel from '../../components/DrawColorPanel'
import StickerStudio from '../../components/StickerStudio'
import MakingStudio from '../../components/MakingStudio'
import { usePatternStore } from '../../store/patternStore'
import { ConversionCancelledError, usePattern } from '../../hooks/usePattern'
import { useLivePreview } from '../../hooks/useLivePreview'
import { getColorSystemForBrand, loadBrand } from '../../utils/palette'
import { getPattern, savePattern, saveNewPatterns } from '../../utils/storage'
import { PatternSaveSession, PatternConflictError, clonePattern } from '../../utils/patternPersistence'
import { ALGORITHM_LABELS, buildConvertParams, patternFromConversion, readPreferredAlgorithm, rememberAlgorithm, algorithmFamily, readContourPreference, rememberContourPreference } from '../../utils/conversionSettings'
import { countByColorId, excludeColor, removeEdgeBackground } from '../../utils/patternOps'
import { generateThumbnail, suggestGridSize } from '../../utils/imageLoader'
import { showToast, showPrompt, showModal, pickImageFile, getImageDimensions, revokeObjectUrl } from '../../utils/webUtils'
import { useRevokeOnUnmount } from '../../hooks/useRevokeOnUnmount'
import { clampEditorGridHeight, validateGridDimensions } from '../../utils/patternLimits'
import {
  COLOR_SYSTEMS,
  TRANSPARENT,
  type BeadColor,
  type BrandId,
  type ConvertParams,
  type ConversionAlgorithm,
  type ColorSystem,
  type Pattern,
} from '../../types'
import './index.scss'

const BEAD_MM = 2.6

// 导出选项持久化（localStorage），跨图纸记住用户的导出偏好
const EXPORT_OPTIONS_KEY = 'pindou.exportOptions.v1'

function savedExportOpt<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(EXPORT_OPTIONS_KEY)
    if (!raw) return fallback
    const opts = JSON.parse(raw)
    return key in opts ? opts[key] : fallback
  } catch {
    return fallback
  }
}

type Stage = 'loading' | 'params' | 'editing'

// 存盘时重画首页卡片用的缩略图；空画板不生成，首页继续显示占位图。
// 色板按图纸自己的品牌取，不依赖页面当前状态（重新转换换品牌时两者会短暂不一致）。
async function saveThumbnail(p: Pattern): Promise<string> {
  if (!p.grid.some(v => v !== TRANSPARENT)) return ''
  try {
    const { colors } = await loadBrand(p.brandId)
    return await generateThumbnail(p.grid, p.width, p.height, p.paletteUsed, colors)
  } catch { return p.thumbnail }
}

export default function EditorPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const patternId  = searchParams.get('patternId') ?? undefined
  const imagePath  = searchParams.get('imagePath') ? decodeURIComponent(searchParams.get('imagePath')!) : undefined
  const isDrawMode = searchParams.get('mode') === 'draw'

  const [stage, setStage]               = useState<Stage>('loading')
  const [brandColors, setBrandColors]   = useState<BeadColor[]>([])
  const [showMaterials, setShowMaterials] = useState(false)
  const [showStickers, setShowStickers] = useState(false)
  const [makingPattern, setMakingPattern] = useState<Pattern | null>(null)
  const [openingMaking, setOpeningMaking] = useState(false)
  const makingLock = useRef(false), exportLock = useRef(false)
  const [selectedSystem, setSelectedSystem] = useState<ColorSystem>('MARD')
  const [brandId, setBrandId]             = useState<BrandId>('mard')
  const [algorithm, setAlgorithm] = useState<ConversionAlgorithm>(readPreferredAlgorithm)
  const [contourEnhance, setContourState] = useState(readContourPreference)
  const setContourEnhance = (enabled: boolean) => { setContourState(enabled); rememberContourPreference(enabled) }
  const [subjectFocus, setSubjectFocus] = useState(false)
  const [comparisonParams, setComparisonParams] = useState<ConvertParams | null>(null)

  const [showGridRef, setShowGridRef]                   = useState(false)
  const [showReconvert, setShowReconvert]               = useState(false)
  const [reconverting, setReconverting]                 = useState(false)
  const [adopting, setAdopting]                         = useState(false)
  const [previewOriginal, setPreviewOriginal]           = useState(false)
  const [showRemoveBgConfirm, setShowRemoveBgConfirm]   = useState(false)

  const [showExport,      setShowExport]      = useState(false)
  const [exportHD,        setExportHD]        = useState(() => savedExportOpt('hd', false))
  const [exportGrid,      setExportGrid]      = useState(() => savedExportOpt('grid', true))
  const [exportLegend,    setExportLegend]    = useState(() => savedExportOpt('legend', true))
  const [exportRuler,     setExportRuler]     = useState(() => savedExportOpt('ruler', true))
  const [exportColorCode,      setExportColorCode]      = useState(() => savedExportOpt('colorCode', true))
  const [exportGuideLines,     setExportGuideLines]     = useState(() => savedExportOpt('guideLines', usePatternStore.getState().showGuideLines))
  const [exportGuideLinesEvery, setExportGuideLinesEvery] = useState<5 | 10>(() => savedExportOpt('guideLinesEvery', 5 as 5 | 10))
  const [exportGuideLinesColor, setExportGuideLinesColor] = useState(() => savedExportOpt('guideLinesColor', usePatternStore.getState().guideLinesColor))
  const [exporting,            setExporting]            = useState(false)

  const [gridWidth, setGridWidth]           = useState(60)
  const [imageAspect, setImageAspect]       = useState(1)
  const gridH = clampEditorGridHeight(gridWidth, imageAspect)
  const [mergeThreshold, setMergeThreshold] = useState(30)
  const [mode, setMode]                     = useState<'dominant' | 'average'>('dominant')
  const [dithering, setDithering]           = useState(false)

  const pattern              = usePatternStore(s => s.pattern)
  const setPattern           = usePatternStore(s => s.setPattern)
  const renamePattern        = usePatternStore(s => s.renamePattern)
  const applyGridAndPalette  = usePatternStore(s => s.applyGridAndPalette)
  const selectedColorIdx     = usePatternStore(s => s.selectedColorIdx)
  const traceImagePath       = usePatternStore(s => s.traceImagePath)
  const setTraceImage        = usePatternStore(s => s.setTraceImage)
  const setSelectedColorById = usePatternStore(s => s.setSelectedColorById)
  const { convert, cancel }  = usePattern()
  const saveSession = useRef<PatternSaveSession | null>(null)
  const [saveFailure, setSaveFailure] = useState<Error | null>(null)
  const [resolvingSave, setResolvingSave] = useState(false)
  const recoveryLock = useRef(false)
  const persistPattern = useCallback(async (p: Pattern) => {
    try {
      if (!saveSession.current || saveSession.current.id !== p.id) throw new Error('图纸尚未加载完成，请稍后重试')
      await saveSession.current.save(p)
      setSaveFailure(null)
    } catch (error) {
      setSaveFailure(error instanceof Error ? error : new Error('保存失败，请重试'))
      throw error
    }
  }, [])

  useEffect(() => cancel, [cancel])

  // 导出选项变化时持久化，下次打开编辑器恢复
  useEffect(() => {
    try {
      localStorage.setItem(EXPORT_OPTIONS_KEY, JSON.stringify({
        hd: exportHD, grid: exportGrid, legend: exportLegend, ruler: exportRuler,
        colorCode: exportColorCode, guideLines: exportGuideLines,
        guideLinesEvery: exportGuideLinesEvery, guideLinesColor: exportGuideLinesColor,
      }))
    } catch { /* 隐私模式等场景下写入失败，忽略 */ }
  }, [exportHD, exportGrid, exportLegend, exportRuler, exportColorCode, exportGuideLines, exportGuideLinesEvery, exportGuideLinesColor])

  // ─── 初始化 ─────────────────────────────────────────────────

  useEffect(() => {
    let disposed = false

    ;(async () => {
      try {
        let targetPattern: Pattern | null = null

        if (isDrawMode) {
          revokeObjectUrl(usePatternStore.getState().traceImagePath)
          setTraceImage(null)
          targetPattern = usePatternStore.getState().pattern
          if (!targetPattern && patternId) targetPattern = await getPattern(patternId)
          if (!targetPattern) throw new Error('空白画板状态已失效，请重新创建')
        } else if (patternId) {
          targetPattern = await getPattern(patternId)
          if (!targetPattern) throw new Error('图纸不存在')
        } else if (!imagePath) {
          targetPattern = usePatternStore.getState().pattern
          if (!targetPattern) {
            navigate('/')
            return
          }
        }

        const loadedBrandId = targetPattern?.brandId ?? 'mard'
        const brand = await loadBrand(loadedBrandId)
        if (disposed) return
        setBrandId(loadedBrandId)
        setSelectedSystem(getColorSystemForBrand(loadedBrandId) ?? 'MARD')
        setBrandColors(brand.colors)

        if (targetPattern) {
          saveSession.current = new PatternSaveSession(targetPattern, savePattern, saveThumbnail)
          setSaveFailure(null)
          setAlgorithm(algorithmFamily(targetPattern.conversionAlgorithm))
          setContourState(targetPattern.conversionParams?.contourEnhance ?? targetPattern.conversionAlgorithm === 'cartoon-v1')
          setGridWidth(targetPattern.width)
          setImageAspect(targetPattern.width / targetPattern.height)
          const settings = targetPattern.conversionParams
          if (settings) {
            setMergeThreshold(settings.mergeThreshold)
            setMode(settings.mode)
            setDithering(settings.dithering)
            setSubjectFocus(settings.subjectFocus ?? false)
          }
          setPattern(targetPattern)
          setStage('editing')
        } else if (imagePath) {
          const { width, height } = await getImageDimensions(imagePath)
          const { aspectRatio: r } = suggestGridSize(width, height)
          if (disposed) return
          setImageAspect(r)
          setStage('params')
        }
      } catch (error) {
        if (disposed) return
        showToast(error instanceof Error ? error.message : '图纸加载失败')
        navigate('/')
      }
    })()

    return () => { disposed = true }
  }, [imagePath, isDrawMode, navigate, patternId, setPattern, setTraceImage])

  useRevokeOnUnmount(
    () => [imagePath, usePatternStore.getState().traceImagePath],
    () => setTraceImage(null),
  )

  // ─── 自动保存 ────────────────────────────────────────────────

  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const latestPatternRef = useRef(pattern)
  latestPatternRef.current = pattern

  useEffect(() => {
    if (stage !== 'editing' || !pattern || pattern.id.startsWith('__')) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void persistPattern(pattern).catch(() => {})
    }, 2000)
    return () => clearTimeout(saveTimer.current)
  }, [pattern, stage, persistPattern])

  useEffect(() => {
    const flush = () => {
      clearTimeout(saveTimer.current)
      const current = latestPatternRef.current
      if (!current || current.id.startsWith('__')) return
      if (saveSession.current?.id !== current.id) return
      void persistPattern(current).catch(() => {})
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const current = latestPatternRef.current
      if (current && saveSession.current?.id === current.id && saveSession.current.isDirty(current)) {
        event.preventDefault(); event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      flush()
    }
  }, [persistPattern])

  async function recoverSave(copy: boolean) {
    if (recoveryLock.current) return
    recoveryLock.current = true
    try {
      if (!copy && !await showModal({ title: '重新读取图纸？', content: '这会放弃本页尚未保存的修改。建议先另存副本。', showCancel: true })) return
      const current = usePatternStore.getState().pattern
      if (!current) return
      setResolvingSave(true)
      clearTimeout(saveTimer.current)
      let restored: Pattern
      if (copy) {
        restored = { ...clonePattern(current), id: nanoid(12), name: `${current.name} · 副本`, createdAt: Date.now(), updatedAt: Date.now() }
        await saveNewPatterns([restored])
      } else {
        const latest = await getPattern(current.id)
        if (!latest) throw new Error('原图纸已被删除，请选择另存副本保留本页修改')
        restored = latest
      }
      const brand = await loadBrand(restored.brandId)
      saveSession.current = new PatternSaveSession(restored, savePattern, saveThumbnail)
      latestPatternRef.current = restored
      setPattern(restored); setBrandColors(brand.colors); setBrandId(restored.brandId)
      setSelectedSystem(getColorSystemForBrand(restored.brandId) ?? 'MARD')
      setSaveFailure(null)
      if (copy) navigate(`/editor?patternId=${restored.id}${isDrawMode ? '&mode=draw' : ''}`, { replace: true })
      showToast(copy ? '已另存副本，原图纸未覆盖' : '已重新读取最新图纸')
    } catch (error) { showToast(error instanceof Error ? error.message : '恢复失败，请重试') }
    finally { recoveryLock.current = false; setResolvingSave(false) }
  }

  async function leaveEditor() {
    const current = usePatternStore.getState().pattern
    if (current && !current.id.startsWith('__')) {
      try { await persistPattern(current) }
      catch { showToast('修改尚未保存，请先另存副本或重新读取'); return }
    }
    navigate(-1)
  }

  // ─── 键盘快捷键（编辑阶段）────────────────────────────────────────
  // Ctrl/Cmd+Z 撤销 · Ctrl/Cmd+Shift+Z / Ctrl+Y 重做 · B/E/F/I 切换工具 · Esc 关闭浮层

  useEffect(() => {
    if (stage !== 'editing' || comparisonParams || showStickers || makingPattern || resolvingSave) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable]')) return

      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const store = usePatternStore.getState()

      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (mod && key === 'y') {
        e.preventDefault()
        store.redo()
        return
      }
      if (mod) return

      if (e.key === 'Escape') {
        // 一次只关最上层的一个浮层
        if (showRemoveBgConfirm) setShowRemoveBgConfirm(false)
        else if (showExport && !exporting) setShowExport(false)
        else if (showReconvert) setShowReconvert(false)
        else if (showMaterials) setShowMaterials(false)
        return
      }

      // 浮层打开时不切换工具
      if (showExport || showReconvert || showMaterials || showRemoveBgConfirm) return

      if (key === 'b') store.setTool('brush')
      else if (key === 'e') store.setTool('eraser')
      else if (key === 'f') store.setTool('fill')
      else if (key === 'i') store.setTool('eyedropper')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [stage, comparisonParams, showStickers, makingPattern, showExport, showReconvert, showMaterials, showRemoveBgConfirm, exporting, resolvingSave])

  // ─── 开始转换 ────────────────────────────────────────────────

  const conversionForm = { algorithm, mode, contourEnhance, subjectFocus, width: gridWidth, height: gridH, brandId, dithering, mergeThreshold }

  // 参数页：参数一变就刷新预览。开着抖动时大图要算更久，等用户停手再算
  const dimensionError = validateGridDimensions(gridWidth, gridH)
  const live = useLivePreview(
    imagePath ?? null,
    stage === 'params' && !dimensionError ? buildConvertParams(conversionForm) : null,
    dithering ? 600 : 200,
  )

  // 编辑器里的「重新转换」：会覆盖当前图纸，所以仍由按钮触发
  const handleReconvert = useCallback(async () => {
    const basePattern = usePatternStore.getState().pattern
    if (!imagePath || !basePattern) return
    const error = validateGridDimensions(gridWidth, gridH)
    if (error) { showToast(error); return }
    setReconverting(true)
    try {
      const convertedPattern = await convert(imagePath, buildConvertParams(conversionForm), undefined, basePattern, persistPattern)
      const brand = await loadBrand(convertedPattern.brandId)
      setBrandColors(brand.colors)
      setSelectedSystem(getColorSystemForBrand(convertedPattern.brandId) ?? 'MARD')
      setShowReconvert(false)
      showToast('已按新设置重新转换')
    } catch (e: any) {
      if (e instanceof ConversionCancelledError) return
      showToast(e.message ?? '转换失败，请重试')
    } finally { setReconverting(false) }
  }, [imagePath, gridWidth, gridH, brandId, algorithm, contourEnhance, subjectFocus, mergeThreshold, mode, dithering, convert, persistPattern])

  const openComparison = () => {
    const error = validateGridDimensions(gridWidth, gridH)
    if (error) { showToast(error); return }
    setComparisonParams(buildConvertParams(conversionForm))
    setShowReconvert(false)
  }

  const adoptResult = async (result: ConversionPreview, colors: BeadColor[], params: ConvertParams) => {
    clearTimeout(saveTimer.current)
    const base = stage === 'editing' ? pattern : null
    const thumbnail = await generateThumbnail(result.grid, params.width, params.height, result.paletteUsed, colors)
    const chosen = patternFromConversion(result, params,
      { id: base?.id ?? nanoid(8), name: base?.name ?? '新图纸', createdAt: base?.createdAt }, thumbnail, result.algorithm)
    if (base) await persistPattern(chosen)
    else { await savePattern(chosen); saveSession.current = new PatternSaveSession(chosen, savePattern, saveThumbnail) }
    rememberAlgorithm(result.algorithm)
    setBrandColors(colors)
    setAlgorithm(algorithmFamily(result.algorithm))
    setContourState(result.algorithm === 'cartoon-v1' && params.mode === 'dominant')
    setSubjectFocus(result.algorithm !== 'legacy' && !!params.subjectFocus)
    setSelectedSystem(getColorSystemForBrand(chosen.brandId) ?? 'MARD')
    setPattern(chosen)
    setComparisonParams(null)
    setStage('editing')
  }

  const keepBothComparisons = async (results: ConversionPreview[], colors: BeadColor[], params: ConvertParams) => {
    const name = stage === 'editing' ? pattern?.name ?? '新图纸' : '新图纸'
    const versions = await Promise.all(results.map(async result => patternFromConversion(result, params,
      { id: nanoid(8), name: `${name} · ${ALGORITHM_LABELS[result.algorithm]}` },
      await generateThumbnail(result.grid, params.width, params.height, result.paletteUsed, colors), result.algorithm)))
    await saveNewPatterns(versions)
    showToast('两个版本已保存，原有图纸未覆盖')
    navigate('/')
  }

  // 参数页的「用这张图纸」：把当前预览存成图纸并进入编辑器
  const adoptPreview = async () => {
    if (!live.fresh || !live.preview || adopting) return
    setAdopting(true)
    try { await adoptResult(live.preview.result, live.preview.colors, live.preview.params) }
    catch (e) { showToast(e instanceof Error ? e.message : '保存失败，请重试') }
    finally { setAdopting(false) }
  }

  // ─── 导入底图 ────────────────────────────────────────────────

  const handleImportTrace = useCallback(async () => {
    try {
      const path = await pickImageFile()
      if (path) {
        revokeObjectUrl(usePatternStore.getState().traceImagePath)
        setTraceImage(path)
      }
    } catch { /* 取消 */ }
  }, [setTraceImage])

  // ─── 去背景 ─────────────────────────────────────────────────

  const handleRemoveBg = useCallback(() => {
    if (!pattern) return
    const result = removeEdgeBackground(pattern.grid, pattern.width, pattern.height, pattern.paletteUsed)
    if (!result) return
    applyGridAndPalette(result.grid, result.paletteUsed)
    showToast('已去除背景，可撤销')
  }, [pattern, applyGridAndPalette])

  // ─── 重命名 ─────────────────────────────────────────────────

  const handleRenamePattern = useCallback(async () => {
    if (!pattern) return
    const name = await showPrompt('重命名图纸', pattern.name)
    if (!name) return
    renamePattern(name)
  }, [pattern, renamePattern])

  // ─── 导出 ────────────────────────────────────────────────────

  const handleExportPNG = useCallback(async () => {
    if (!pattern || exportLock.current) return
    exportLock.current = true
    setExporting(true)
    try {
      await exportPatternToPNG(pattern, brandColors, {
        hd: exportHD, showGrid: exportGrid, showLegend: exportLegend,
        showRuler: exportRuler, showColorCode: exportColorCode,
        showGuideLines:     exportGuideLines,
        guideLinesEvery:    exportGuideLinesEvery,
        guideLinesColor:    exportGuideLinesColor,
      })
      setShowExport(false)
    } catch (e: any) {
      showToast(e.message || '导出失败，请重试')
    } finally {
      exportLock.current = false
      setExporting(false)
    }
  }, [
    pattern, brandColors, exportHD, exportGrid, exportLegend, exportRuler,
    exportColorCode, exportGuideLines, exportGuideLinesEvery, exportGuideLinesColor,
  ])

  const handleExportPDF = useCallback(async () => {
    if (!pattern || exportLock.current) return
    exportLock.current = true
    setExporting(true)
    try {
      const { exportPatternToPDF } = await import('../../utils/exportPDF')
      await exportPatternToPDF(pattern, brandColors)
      setShowExport(false)
    } catch (e: any) {
      showToast(e.message || '导出失败，请重试')
    } finally {
      exportLock.current = false
      setExporting(false)
    }
  }, [pattern, brandColors])

  async function openMaking() {
    if (!pattern || pattern.id.startsWith('__') || makingLock.current) return
    makingLock.current = true; setOpeningMaking(true)
    const snapshot = { ...pattern, grid: pattern.grid.slice(), paletteUsed: [...pattern.paletteUsed] }
    try {
      await persistPattern(snapshot)
      setShowExport(false); setMakingPattern(snapshot)
    } catch (e) { showToast(e instanceof Error ? e.message : '图纸保存失败，请重试') }
    finally { makingLock.current = false; setOpeningMaking(false) }
  }

  // ─── 排除颜色 ────────────────────────────────────────────────

  const applyExclusion = useCallback((excludedColorId: number) => {
    if (!pattern) return
    const result = excludeColor(pattern.grid, pattern.paletteUsed, excludedColorId, brandColors)
    if (!result) return
    applyGridAndPalette(result.grid, result.paletteUsed)
    showToast(`已排除 ${result.excluded.code}，可撤销`)
  }, [pattern, brandColors, applyGridAndPalette])

  // ─── 用料清单数据 ────────────────────────────────────────────

  const colorById = new Map(brandColors.map(c => [c.id, c]))
  const materials = pattern
    ? [...countByColorId(pattern.grid, pattern.paletteUsed)]
        .map(([id, count]) => ({ color: colorById.get(id), count }))
        .filter(i => i.color)
        .sort((a, b) => b.count - a.count)
    : []
  const totalBeads = materials.reduce((s, i) => s + i.count, 0)

  // ─── 渲染 ─────────────────────────────────────────────────────

  if (makingPattern) return <MakingStudio pattern={makingPattern} colors={brandColors} onClose={() => setMakingPattern(null)} />

  if (stage === 'loading') {
    return (
      <div className="editor-loading">
        <div className="editor-loading__dots">
          <div className="editor-loading__dot" />
          <div className="editor-loading__dot editor-loading__dot--2" />
          <div className="editor-loading__dot editor-loading__dot--3" />
        </div>
      </div>
    )
  }

  if (comparisonParams && imagePath) {
    return <AlgorithmComparison imagePath={imagePath} params={comparisonParams}
      onClose={() => setComparisonParams(null)} onUse={adoptResult} onKeepBoth={keepBothComparisons} />
  }

  if (stage === 'params') {
    const wCm = (gridWidth * BEAD_MM / 10).toFixed(1)
    const hCm = (gridH     * BEAD_MM / 10).toFixed(1)
    const previewStatus = dimensionError ?? live.error ?? (live.preview
      ? `${live.preview.stats.colors} 种颜色 · ${live.preview.stats.beads} 粒${live.pending ? ' · 更新中…' : ''}`
      : '正在生成预览…')
    return (
      <div className="editor-page editor-page--dark">
        <div className="editor-topbar">
          <Button className="editor-topbar__back" onClick={() => navigate(-1)}>
            <span className="editor-topbar__back-text">‹ 返回</span>
          </Button>
          <div className="editor-topbar__identity">
            <span className="editor-topbar__title">转换设置</span>
            <span className="topbar-step-badge">步骤 2/3</span>
          </div>
          <div style={{ width: 52 }} />
        </div>

        <div className="params-layout">
          <div className="params-preview">
            <div className="params-preview__stage">
              {imagePath && (previewOriginal || !live.preview
                ? <img className="params-preview__img" src={imagePath} alt="原图" />
                : <img className={`params-preview__img params-preview__img--pattern${live.pending ? ' params-preview__img--stale' : ''}`}
                    src={live.preview.image} alt="图纸预览" />)}
            </div>
            <div className="params-preview__bar">
              <div className="params-preview__tabs">
                <Button className="params-preview__tab" aria-pressed={!previewOriginal} onClick={() => setPreviewOriginal(false)}>图纸</Button>
                <Button className="params-preview__tab" aria-pressed={previewOriginal} onClick={() => setPreviewOriginal(true)}>原图</Button>
              </div>
              <span className="params-preview__stats" role="status">{previewStatus}</span>
            </div>
          </div>

          <div className="params-body">
          <ConvertParamsForm
            algorithm={algorithm} setAlgorithm={setAlgorithm} onCompare={openComparison}
            subjectFocus={subjectFocus} setSubjectFocus={setSubjectFocus}
            contourEnhance={contourEnhance} setContourEnhance={setContourEnhance}
            idPrefix="convert"
            brandId={brandId}
            setBrandId={setBrandId}
            gridWidth={gridWidth}
            setGridWidth={setGridWidth}
            mergeThreshold={mergeThreshold}
            setMergeThreshold={setMergeThreshold}
            mode={mode}
            setMode={setMode}
            dithering={dithering}
            setDithering={setDithering}
            sizeLabel={`${gridWidth}×${gridH} 格 · ${wCm}×${hCm} cm`}
          />
          </div>
        </div>

        <div className="params-footer">
          <Button className="params-convert-btn" disabled={!live.fresh || adopting} onClick={() => void adoptPreview()}>
            <span className="params-convert-btn__text">{adopting ? '正在保存…' : live.fresh ? '用这张图纸 ›' : dimensionError || live.error ? '无法生成预览' : '正在生成预览…'}</span>
          </Button>
        </div>
      </div>
    )
  }

  const selectedColorId = (pattern && selectedColorIdx < pattern.paletteUsed.length)
    ? pattern.paletteUsed[selectedColorIdx]
    : undefined

  const selectedColorRgb = selectedColorId !== undefined
    ? (brandColors.find(c => c.id === selectedColorId)?.rgb ?? null)
    : null

  const materialsOverlay = !isDrawMode && showMaterials && (
    <div className="materials-overlay" onClick={() => setShowMaterials(false)}>
      <div className="materials-panel" onClick={e => e.stopPropagation()}>
        <div className="materials-panel__header">
          <span className="materials-panel__title">用料清单</span>
          <span className="materials-panel__total">共 {totalBeads} 粒</span>
          <Button className="materials-panel__close" aria-label="关闭用料清单" onClick={() => setShowMaterials(false)}>
            <img className="materials-panel__close-icon" src={closeIcon} alt="" />
          </Button>
        </div>

        {brandColors[0]?.brandCodes && (
          <div className="materials-systems">
            {COLOR_SYSTEMS.map(sys => (
              <Button
                key={sys}
                className={`materials-system-tab ${selectedSystem === sys ? 'materials-system-tab--active' : ''}`}
                aria-pressed={selectedSystem === sys}
                onClick={() => setSelectedSystem(sys)}
              >
                <span className="materials-system-tab__text">{sys}</span>
              </Button>
            ))}
          </div>
        )}

        <div className="materials-panel__list">
          {materials.map(({ color, count }) => {
            const displayCode = color!.brandCodes?.[selectedSystem] ?? color!.code
            const refCode = selectedSystem !== 'MARD' && color!.brandCodes
              ? color!.brandCodes['MARD']
              : undefined
            return (
              <div key={color!.id} className="materials-row">
                <div
                  className="materials-row__dot"
                  style={{ backgroundColor: `rgb(${color!.rgb[0]},${color!.rgb[1]},${color!.rgb[2]})` }}
                />
                <div className="materials-row__codes">
                  <span className="materials-row__code">{displayCode}</span>
                  {refCode && <span className="materials-row__ref">MARD {refCode}</span>}
                </div>
                <span className="materials-row__count">{count} 粒</span>
                <Button className="materials-row__exclude" aria-label={`排除颜色 ${displayCode}`} onClick={() => applyExclusion(color!.id)}>
                  <span className="materials-row__exclude-icon">×</span>
                </Button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  return (
    <div className="editor-root" style={resolvingSave ? { pointerEvents: 'none' } : undefined}>
      <div className="editor-page">
        <div className="editor-topbar">
          {/* 左区：导航 */}
          <Button className="editor-topbar__back" onClick={() => void leaveEditor()}>
            <span className="editor-topbar__back-text">‹ 返回</span>
          </Button>

          {/* 中区：图纸标识 + 用色数量 */}
          <div className="editor-topbar__identity">
            <Button className="editor-topbar__title-wrap" aria-label="重命名图纸" onClick={handleRenamePattern}>
              <span className="editor-topbar__title">{pattern?.name ?? '图纸编辑'}</span>
              <span className="editor-topbar__title-edit-icon" />
            </Button>
            {!isDrawMode && pattern && (
              <Button className="topbar-color-pill" onClick={() => setShowMaterials(true)}>
                <span className="topbar-color-pill__text">用 {pattern.paletteUsed.length} 色</span>
              </Button>
            )}
          </div>

          {/* 右区：操作三层 */}
          <Button className="editor-making-button" onClick={() => void openMaking()} disabled={openingMaking || !pattern || pattern.id.startsWith('__') || !brandColors.length}>{openingMaking ? '准备中' : '制作'}</Button>
          <Button className="editor-sticker-button" onClick={() => setShowStickers(true)} disabled={!pattern || !brandColors.length}>贴纸</Button>
          {isDrawMode ? (
            <div className="editor-topbar__actions">
              <Button className="editor-topbar__btn" onClick={handleImportTrace}>
                <span className="editor-topbar__btn-text">
                  {traceImagePath ? '换底图' : '导入底图'}
                </span>
              </Button>
            </div>
          ) : (
            <div className="editor-topbar__actions">
              {/* 层级 3：视图控制（ghost toggle） */}
              <Button
                className={`editor-topbar__toggle ${showGridRef ? 'editor-topbar__toggle--on' : ''}`}
                aria-pressed={showGridRef}
                onClick={() => setShowGridRef(v => !v)}
              >
                <span className="editor-topbar__btn-text">色号坐标</span>
              </Button>
              {/* 层级 2：生成控制（outline，仅图片来源时显示） */}
              {imagePath && (
                <Button className="editor-topbar__btn editor-topbar__btn--regen" onClick={() => setShowReconvert(true)}>
                  <span className="editor-topbar__btn-text">重新生成</span>
                </Button>
              )}
              {/* 层级 1：主 CTA（实心） */}
              <Button className="editor-topbar__btn editor-topbar__btn--primary" onClick={() => setShowExport(true)}>
                <span className="editor-topbar__btn-text">导出</span>
              </Button>
            </div>
          )}
        </div>

        {saveFailure && <section className="editor-save-warning" role="alert" aria-label="图纸保存提醒">
          <p>{saveFailure.message}</p>
          <p>未保存的修改仅在本页内存中，关闭页面可能丢失；也可先导出图片留底。</p>
          <div>
            <Button disabled={resolvingSave} onClick={() => void recoverSave(true)}>另存副本</Button>
            <Button disabled={resolvingSave} onClick={() => void recoverSave(false)}>重新读取</Button>
            {!(saveFailure instanceof PatternConflictError) && <Button disabled={resolvingSave} onClick={() => { const p = usePatternStore.getState().pattern; if (p) void persistPattern(p).catch(() => {}) }}>重试保存</Button>}
          </div>
        </section>}
        <div className="editor-canvas">
          {isDrawMode && selectedColorRgb && (
            <div className="canvas-brush-indicator">
              <div
                className="canvas-brush-indicator__swatch"
                style={{ background: `rgb(${selectedColorRgb[0]},${selectedColorRgb[1]},${selectedColorRgb[2]})` }}
              />
              <span className="canvas-brush-indicator__label">画笔色</span>
            </div>
          )}
          {brandColors.length > 0 && !showMaterials && (
            <PatternCanvas
              brandColors={brandColors}
              showColorCode={showGridRef}
              showRuler={showGridRef}
            />
          )}
          {isDrawMode && traceImagePath && (
            <img
              className="editor-trace-image"
              src={traceImagePath}
              style={{ width: '100%', height: '100%', objectFit: 'fill' }}
              alt=""
            />
          )}
        </div>

        {isDrawMode ? (
          <DrawColorPanel
            brandColors={brandColors}
            paletteUsed={pattern?.paletteUsed ?? []}
            selectedColorId={selectedColorId}
            onSelectColor={setSelectedColorById}
          />
        ) : (
          <ColorPanel
            brandColors={brandColors}
            paramsTab={imagePath ? ({
              algorithm, setAlgorithm, onCompare: openComparison, subjectFocus, setSubjectFocus, contourEnhance, setContourEnhance,
              brandId,
              setBrandId,
              gridWidth,
              setGridWidth,
              mergeThreshold,
              setMergeThreshold,
              mode,
              setMode,
              dithering,
              setDithering,
              sizeLabel: `${gridWidth}×${gridH} 格 · ${gridWidth * gridH} 粒 · ${(gridWidth * BEAD_MM / 10).toFixed(1)}×${(gridH * BEAD_MM / 10).toFixed(1)} cm`,
              onReconvert: () => void handleReconvert(),
              reconverting,
            } satisfies ParamsTabProps) : undefined}
          />
        )}
        <ToolBar />
      </div>

      {materialsOverlay}
      {showStickers && pattern && brandColors.length > 0 && <StickerStudio pattern={pattern} brandColors={brandColors} onClose={() => setShowStickers(false)} />}

      {showReconvert && imagePath && (
        <div className="export-overlay" onClick={() => setShowReconvert(false)}>
          <div className="reconvert-sheet" onClick={e => e.stopPropagation()}>
            <div className="export-sheet__handle" />
            <div className="export-sheet__header">
              <span className="export-sheet__title">重新生成</span>
            </div>

            <div className="reconvert-body">
              <ConvertParamsForm
                algorithm={algorithm} setAlgorithm={setAlgorithm} onCompare={openComparison}
                subjectFocus={subjectFocus} setSubjectFocus={setSubjectFocus}
                contourEnhance={contourEnhance} setContourEnhance={setContourEnhance}
                idPrefix="reconvert"
                brandId={brandId}
                setBrandId={setBrandId}
                gridWidth={gridWidth}
                setGridWidth={setGridWidth}
                mergeThreshold={mergeThreshold}
                setMergeThreshold={setMergeThreshold}
                mode={mode}
                setMode={setMode}
                dithering={dithering}
                setDithering={setDithering}
                sizeLabel={`${gridWidth}×${gridH} 格 · ${gridWidth * gridH} 粒 · ${(gridWidth * BEAD_MM / 10).toFixed(1)}×${(gridH * BEAD_MM / 10).toFixed(1)} cm`}
              />

              {/* 后处理操作 — 破坏性，视觉隔离 */}
              <div className="reconvert-danger-section">
                <div className="reconvert-danger-row">
                  <div>
                    <span className="reconvert-danger-label">去除背景色</span>
                    <span className="params-hint-inline">自动识别并清除图纸边缘颜色，可通过撤销恢复</span>
                  </div>
                  <Button className="reconvert-danger-btn" onClick={() => { setShowReconvert(false); setShowRemoveBgConfirm(true) }}>
                    去背景
                  </Button>
                </div>
              </div>
            </div>

            <div className="reconvert-footer">
              <Button className="params-convert-btn" disabled={reconverting} onClick={() => void handleReconvert()}>
                <span className="params-convert-btn__text">{reconverting ? '转换中…' : '重新转换'}</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {showRemoveBgConfirm && (
        <div className="remove-bg-overlay" onClick={() => setShowRemoveBgConfirm(false)}>
          <div className="remove-bg-dialog" onClick={e => e.stopPropagation()}>
            <span className="remove-bg-dialog__title">确认去除背景？</span>
            <p className="remove-bg-dialog__desc">将自动识别并清除图纸边缘颜色，可通过撤销（Ctrl+Z）恢复。</p>
            <div className="remove-bg-dialog__actions">
              <Button className="remove-bg-dialog__btn remove-bg-dialog__btn--cancel" onClick={() => setShowRemoveBgConfirm(false)}>
                取消
              </Button>
              <Button className="remove-bg-dialog__btn remove-bg-dialog__btn--confirm" onClick={() => { setShowRemoveBgConfirm(false); handleRemoveBg() }}>
                确认去背景
              </Button>
            </div>
          </div>
        </div>
      )}

      {showExport && (
        <div className="export-overlay" onClick={() => !exporting && setShowExport(false)}>
          <div className="export-sheet" onClick={e => e.stopPropagation()}>
            <div className="export-sheet__handle" />
            <div className="export-sheet__header">
              <span className="export-sheet__title">导出图纸</span>
            </div>

            <div className="export-section">
              <span className="export-section__label">导出图片</span>
              <div className="export-row">
                <span className="export-row__key">规格</span>
                <div className="export-seg">
                  <Button
                    className={`export-seg__item ${!exportHD ? 'export-seg__item--active' : ''}`}
                    aria-pressed={!exportHD}
                    onClick={() => setExportHD(false)}
                  >
                    <span className="export-seg__text">标准 16px</span>
                  </Button>
                  <Button
                    className={`export-seg__item ${exportHD ? 'export-seg__item--active' : ''}`}
                    aria-pressed={exportHD}
                    onClick={() => setExportHD(true)}
                  >
                    <span className="export-seg__text">高清 48px</span>
                  </Button>
                </div>
              </div>

              <Button className="export-row" aria-pressed={exportGrid} onClick={() => setExportGrid(v => !v)}>
                <span className="export-row__key">含网格线</span>
                <span className={`export-sw ${exportGrid ? 'export-sw--on' : ''}`}>
                  <span className="export-sw__knob" />
                </span>
              </Button>

              <Button className="export-row" aria-pressed={exportLegend} onClick={() => setExportLegend(v => !v)}>
                <span>
                  <span className="export-row__key">含颜色图例</span>
                  <span className="export-row__hint">色号 + 用量列表</span>
                </span>
                <span className={`export-sw ${exportLegend ? 'export-sw--on' : ''}`}>
                  <span className="export-sw__knob" />
                </span>
              </Button>

              <Button className="export-row" aria-pressed={exportRuler} onClick={() => setExportRuler(v => !v)}>
                <span>
                  <span className="export-row__key">含行列编号</span>
                  <span className="export-row__hint">图纸四边的坐标数字</span>
                </span>
                <span className={`export-sw ${exportRuler ? 'export-sw--on' : ''}`}>
                  <span className="export-sw__knob" />
                </span>
              </Button>

              <Button className="export-row" aria-pressed={exportColorCode} onClick={() => setExportColorCode(v => !v)}>
                <span>
                  <span className="export-row__key">含珠子色号</span>
                  <span className="export-row__hint">仅高清模式下显示</span>
                </span>
                <span className={`export-sw ${exportColorCode ? 'export-sw--on' : ''}`}>
                  <span className="export-sw__knob" />
                </span>
              </Button>

              <Button className="export-row" aria-pressed={exportGuideLines} onClick={() => setExportGuideLines(v => !v)}>
                <span>
                  <span className="export-row__key">含分组划线</span>
                  <span className="export-row__hint">每 N 格加一条明显分隔线</span>
                </span>
                <span className={`export-sw ${exportGuideLines ? 'export-sw--on' : ''}`}>
                  <span className="export-sw__knob" />
                </span>
              </Button>

              {exportGuideLines && (
                <>
                  <div className="export-row">
                    <span className="export-row__key">划线间距</span>
                    <div className="export-seg">
                      <Button
                        className={`export-seg__item ${exportGuideLinesEvery === 5 ? 'export-seg__item--active' : ''}`}
                        aria-pressed={exportGuideLinesEvery === 5}
                        onClick={() => setExportGuideLinesEvery(5)}
                      >
                        <span className="export-seg__text">每 5 格</span>
                      </Button>
                      <Button
                        className={`export-seg__item ${exportGuideLinesEvery === 10 ? 'export-seg__item--active' : ''}`}
                        aria-pressed={exportGuideLinesEvery === 10}
                        onClick={() => setExportGuideLinesEvery(10)}
                      >
                        <span className="export-seg__text">每 10 格</span>
                      </Button>
                    </div>
                  </div>

                  <div className="export-row export-row--align-top">
                    <span className="export-row__key">划线颜色</span>
                    <div className="export-guide-colors">
                      {(['#e53935', '#ffffff', '#d4d4d4', '#808080', '#000000'] as const).map(c => (
                        <Button
                          key={c}
                          className={`export-guide-chip ${exportGuideLinesColor === c ? 'export-guide-chip--active' : ''}`}
                          style={{ background: c }}
                          aria-label={`划线颜色 ${c}`}
                          aria-pressed={exportGuideLinesColor === c}
                          onClick={(e) => { e.stopPropagation(); setExportGuideLinesColor(c) }}
                        />
                      ))}
                      <label className="export-guide-custom">
                        <input
                          type="color"
                          value={exportGuideLinesColor}
                          onChange={e => setExportGuideLinesColor(e.target.value)}
                          onClick={e => e.stopPropagation()}
                        />
                        <span className="export-guide-custom__swatch" style={{ background: exportGuideLinesColor }} />
                      </label>
                    </div>
                  </div>
                </>
              )}

              <Button
                className={`export-btn ${exporting ? 'export-btn--disabled' : ''}`}
                disabled={exporting}
                onClick={handleExportPNG}
              >
                <span className="export-btn__text">
                  {exporting ? '导出中…' : '下载图片'}
                </span>
              </Button>
            </div>

            <div className="export-section export-section--last">
              <span className="export-section__label">导出 PDF</span>
              <span className="export-section__desc">完整图纸 + 全部用料清单，颜色多时自动分页</span>
              <Button
                className={`export-btn export-btn--outline ${exporting ? 'export-btn--disabled' : ''}`}
                disabled={exporting}
                onClick={handleExportPDF}
              >
                <span className="export-btn__text export-btn__text--outline">
                  {exporting ? '生成中…' : '导出 PDF'}
                </span>
              </Button>
              <Button className="export-btn export-btn--outline" disabled={exporting || openingMaking} onClick={() => void openMaking()}>制作进度与珠板分块打印</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
