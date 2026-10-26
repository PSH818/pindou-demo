import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import gridDotsIcon from '../../assets/icons/grid-dots.svg'
import logoIcon      from '../../assets/icons/logo.svg'
import analyzeIcon   from '../../assets/icons/analyze.svg'
import sampleImage   from '../../assets/sample-mushroom.png'
import PatternCard from '../../components/PatternCard'
import Button from '../../components/Button'
import { listPatterns, deletePattern, savePattern, checkCapacity } from '../../utils/storage'
import { showToast, showModal, showPrompt, showActionSheet, pickImageFile } from '../../utils/webUtils'
import { usePatternStore } from '../../store/patternStore'
import type { PatternMeta } from '../../types'
import './index.scss'

export default function IndexPage() {
  const navigate = useNavigate()
  const [patterns, setPatterns]       = useState<PatternMeta[]>([])
  const [loading, setLoading]         = useState(true)
  const [creating, setCreating]       = useState(false)
  const [managing, setManaging]       = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<PatternMeta[] | null>(null)

  const undoTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingDeleteRef = useRef<PatternMeta[] | null>(null)

  const loadList = useCallback(async () => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
    if (pendingDeleteRef.current) {
      await Promise.all(pendingDeleteRef.current.map(p => deletePattern(p.id)))
      pendingDeleteRef.current = null
      setPendingDelete(null)
    }
    const list = await listPatterns()
    setPatterns(list)
    setLoading(false)
    setManaging(false)
    setSelectedIds(new Set())
  }, [])

  useEffect(() => { loadList() }, [])

  // ─── 新建图纸 ─────────────────────────────────────────────

  const handleNew = useCallback(async () => {
    if (creating) return
    const { isFull } = await checkCapacity()
    if (isFull) {
      await showModal({ title: '图纸已满', content: '本地最多保存 50 张图纸，请先删除一些旧图纸。', showCancel: false })
      return
    }
    try {
      const tempPath = await pickImageFile()
      if (!tempPath) return
      setCreating(true)
      navigate(`/preprocess?imagePath=${encodeURIComponent(tempPath)}`)
    } catch (e: any) {
      if (String(e.message).includes('cancel') || String(e.message).includes('取消')) return
      showToast('选图失败，请重试')
    } finally {
      setCreating(false)
    }
  }, [creating, navigate])

  // Ctrl+V 粘贴图片 → 直接进"新建图纸"流程
  useEffect(() => {
    async function onPaste(e: ClipboardEvent) {
      const file = Array.from(e.clipboardData?.items ?? [])
        .find(item => item.type.startsWith('image/'))
        ?.getAsFile()
      if (!file) return
      const { isFull } = await checkCapacity()
      if (isFull) {
        showToast('图纸已满，请先删除一些旧图纸')
        return
      }
      navigate(`/preprocess?imagePath=${encodeURIComponent(URL.createObjectURL(file))}`)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [navigate])

  // ─── 示例图：与上传同路径（blob URL），预处理页按上传图片一样回收 ──────

  const handleSample = useCallback(async () => {
    if (creating) return
    const { isFull } = await checkCapacity()
    if (isFull) {
      await showModal({ title: '图纸已满', content: '本地最多保存 50 张图纸，请先删除一些旧图纸。', showCancel: false })
      return
    }
    try {
      setCreating(true)
      const blob = await (await fetch(sampleImage)).blob()
      navigate(`/preprocess?imagePath=${encodeURIComponent(URL.createObjectURL(blob))}`)
    } catch {
      showToast('示例图加载失败，请重试')
    } finally {
      setCreating(false)
    }
  }, [creating, navigate])

  // ─── 新建空白画板 ─────────────────────────────────────────

  const handleNewDraw = useCallback(async () => {
    const { isFull } = await checkCapacity()
    if (isFull) {
      await showModal({ title: '图纸已满', content: '本地最多保存 50 张图纸，请先删除一些旧图纸。', showCancel: false })
      return
    }
    navigate('/canvas-setup')
  }, [navigate])

  // ─── 打开历史图纸 ─────────────────────────────────────────

  const handleOpen = useCallback((id: string) => {
    usePatternStore.getState().clearPattern()
    navigate(`/editor?patternId=${id}`)
  }, [navigate])

  // ─── 长按操作菜单 ─────────────────────────────────────────

  const handleLongPress = useCallback(async (meta: PatternMeta) => {
    const action = await showActionSheet(['重命名', { text: '删除', destructive: true }])
    if (action === 0) handleRename(meta)
    if (action === 1) handleSingleDelete(meta)
  }, [])

  const handleRename = async (meta: PatternMeta) => {
    const name = await showPrompt('重命名', meta.name)
    if (!name) return
    const { getPattern } = await import('../../utils/storage')
    const full = await getPattern(meta.id)
    if (!full) return
    try { await savePattern({ ...full, name, updatedAt: Date.now() }, full) }
    catch (error) { showToast(error instanceof Error ? error.message : '重命名失败'); return }
    setPatterns(prev => prev.map(p => p.id === meta.id ? { ...p, name } : p))
  }

  const handleSingleDelete = async (meta: PatternMeta) => {
    const ok = await showModal({
      title: '删除图纸',
      content: `确定删除「${meta.name}」？此操作不可恢复。`,
      showCancel: true,
    })
    if (!ok) return
    await deletePattern(meta.id)
    setPatterns(prev => prev.filter(p => p.id !== meta.id))
    showToast('已删除')
  }

  // ─── 管理模式 ─────────────────────────────────────────────

  const enterManage = useCallback(() => {
    setManaging(true)
    setSelectedIds(new Set())
  }, [])

  const exitManage = useCallback(() => {
    setManaging(false)
    setSelectedIds(new Set())
  }, [])

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleSelectAll = useCallback((currentPatterns: PatternMeta[]) => {
    setSelectedIds(prev =>
      prev.size === currentPatterns.length
        ? new Set()
        : new Set(currentPatterns.map(p => p.id))
    )
  }, [])

  // ─── 批量删除（乐观 + 撤销） ──────────────────────────────

  const handleBatchDelete = useCallback((currentPatterns: PatternMeta[], ids: Set<string>) => {
    const toDelete = currentPatterns.filter(p => ids.has(p.id))
    if (toDelete.length === 0) return

    setPatterns(prev => prev.filter(p => !ids.has(p.id)))
    pendingDeleteRef.current = toDelete
    setPendingDelete(toDelete)
    setSelectedIds(new Set())
    setManaging(false)

    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = setTimeout(async () => {
      await Promise.all(toDelete.map(p => deletePattern(p.id)))
      pendingDeleteRef.current = null
      setPendingDelete(null)
      undoTimerRef.current = null
    }, 3000)
  }, [])

  const handleUndo = useCallback(() => {
    if (!pendingDeleteRef.current) return
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
    const restored = pendingDeleteRef.current
    pendingDeleteRef.current = null
    setPendingDelete(null)
    setPatterns(prev =>
      [...restored, ...prev].sort((a, b) => b.updatedAt - a.updatedAt)
    )
  }, [])

  const allSelected = patterns.length > 0 && selectedIds.size === patterns.length

  return (
    <div className="index-root">
      <div
        className={`index-page${managing ? ' index-page--managing' : ''}`}
      >
        <IndexHeader />

        <div className="index-entries">
          <Button
            className={`index-entry index-entry--photo${creating ? ' index-entry--loading' : ''}`}
            disabled={creating}
            onClick={handleNew}
          >
            <span className="index-entry__icon-wrap index-entry__icon-wrap--photo">
              <span className="index-entry__plus">{creating ? '…' : '+'}</span>
            </span>
            <span className="index-entry__title">{creating ? '创建中…' : '新建图纸'}</span>
            <span className="index-entry__hint">选择图片 · 或 Ctrl+V 粘贴</span>
          </Button>
          <Button className="index-entry index-entry--draw" onClick={handleNewDraw}>
            <span className="index-entry__icon-wrap index-entry__icon-wrap--draw">
              <span className="index-entry__brush-icon" />
            </span>
            <span className="index-entry__title">空白画板</span>
            <span className="index-entry__hint">自由手绘拼豆</span>
          </Button>
          <Button className="index-entry index-entry--analyze" onClick={() => navigate('/analyze')}>
            <span className="index-entry__icon-wrap index-entry__icon-wrap--analyze">
              <img className="index-entry__icon-img" src={analyzeIcon} alt="" />
            </span>
            <span className="index-entry__title">分析图纸</span>
            <span className="index-entry__hint">识别色号 · 导出用料清单</span>
          </Button>
          <Button className="index-entry index-entry--template" disabled={creating} onClick={handleSample}>
            <span className="index-entry__title">用示例图试试</span>
            <span className="index-entry__hint">没有图片也能走完整流程</span>
          </Button>
        </div>

        <div className="index-section">
          <div className="index-section__header">
            <span className="index-section__title">我的图纸</span>
            {!loading && patterns.length > 0 && (
              <>
                <span className="index-section__count">{patterns.length} / 50</span>
                <Button
                  className="index-section__manage-btn"
                  onClick={managing ? exitManage : enterManage}
                >
                  <span className="index-section__manage-text">
                    {managing ? '完成' : '管理'}
                  </span>
                </Button>
              </>
            )}
          </div>

          {loading ? (
            <div className="index-grid">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : patterns.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="index-grid">
              {patterns.map(p => (
                <PatternCard
                  key={p.id}
                  pattern={p}
                  managing={managing}
                  selected={selectedIds.has(p.id)}
                  onTap={() => handleOpen(p.id)}
                  onLongPress={() => handleLongPress(p)}
                  onSelect={() => handleToggleSelect(p.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {managing && (
        <div className="index-manage-bar">
          <Button
            className="index-manage-bar__left"
            onClick={() => handleSelectAll(patterns)}
          >
            <span className={`index-manage-bar__check${allSelected ? ' index-manage-bar__check--on' : ''}`}>
              {allSelected && <span className="index-manage-bar__check-mark">✓</span>}
            </span>
            <span className="index-manage-bar__label">全选</span>
          </Button>

          <span className="index-manage-bar__count">
            {selectedIds.size > 0 ? `已选 ${selectedIds.size} 张` : '点击卡片选择'}
          </span>

          <Button
            className={`index-manage-bar__del${selectedIds.size > 0 ? ' index-manage-bar__del--active' : ''}`}
            disabled={selectedIds.size === 0}
            aria-label="删除选中图纸"
            onClick={() => handleBatchDelete(patterns, selectedIds)}
          >
            <span className="index-manage-bar__trash-icon" />
          </Button>
        </div>
      )}

      {pendingDelete && (
        <div className="index-undo-toast">
          <span className="index-undo-toast__text">
            已删除 {pendingDelete.length} 张图纸
          </span>
          <Button className="index-undo-toast__btn" onClick={handleUndo}>
            <span className="index-undo-toast__btn-text">撤销</span>
          </Button>
        </div>
      )}
    </div>
  )
}

// showActionSheet 已从 utils/webUtils 导入（统一反馈组件，见 components/Feedback）

function IndexHeader() {
  return (
    <div className="index-header">
      <img className="index-header__logo" src={logoIcon} alt="logo" />
      <div className="index-header__text">
        <span className="index-header__title">拼豆图纸</span>
        <span className="index-header__sub">照片一键转拼豆图纸</span>
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton-thumb" />
      <div className="skeleton-info">
        <div className="skeleton-line skeleton-line--name" />
        <div className="skeleton-line skeleton-line--time" />
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="index-empty">
      <img className="index-empty__icon" src={gridDotsIcon} alt="" />
      <span className="index-empty__title">还没有图纸</span>
      <span className="index-empty__hint">点击上方「新建图纸」开始第一个创作</span>
    </div>
  )
}
