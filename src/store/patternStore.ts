import { create } from 'zustand'
import { TRANSPARENT, type Pattern, type EditTool } from '../types'

// 撤销栈最大步数
const MAX_HISTORY = 30

// 撤销快照：grid + 色板。去背景 / 排除颜色会重映射色板下标，
// 只存 grid 会导致撤销后下标指向错误的颜色。
interface HistorySnapshot {
  grid: Uint16Array
  paletteUsed: number[]
}

interface PatternStore {
  // 当前图纸
  pattern: Pattern | null
  // 撤销/重做栈（存 grid + paletteUsed 快照，不存整个 pattern）
  history: HistorySnapshot[]
  historyIndex: number
  // 编辑器状态
  tool: EditTool
  selectedColorIdx: number    // paletteUsed 中的下标
  highlightColorIdx: number | null
  scale: number               // px/格
  offsetX: number
  offsetY: number
  // 手绘模式：底图临时路径（不持久化）
  traceImagePath: string | null
  // 编辑器格线显示
  showGuideLines: boolean
  guideLinesColor: string

  // Actions
  setPattern: (p: Pattern) => void
  clearPattern: () => void
  paintCell: (x: number, y: number) => void
  fillRegion: (x: number, y: number) => void
  eraseCell: (x: number, y: number) => void
  pickColor: (x: number, y: number) => void
  applyGridAndPalette: (grid: Uint16Array, paletteUsed: number[]) => void
  undo: () => void
  redo: () => void
  setTool: (tool: EditTool) => void
  setSelectedColor: (idx: number) => void
  setHighlightColor: (idx: number | null) => void
  setScale: (scale: number) => void
  setOffset: (x: number, y: number) => void
  setTraceImage: (path: string | null) => void
  setSelectedColorById: (colorId: number) => void
  renamePattern: (name: string) => void
  setShowGuideLines: (v: boolean) => void
  setGuideLinesColor: (c: string) => void
}

export const usePatternStore = create<PatternStore>((set, get) => ({
  pattern: null,
  history: [],
  historyIndex: -1,
  tool: 'brush',
  selectedColorIdx: 0,
  highlightColorIdx: null,
  scale: 16,
  offsetX: 0,
  offsetY: 0,
  traceImagePath: null,
  showGuideLines: true,
  guideLinesColor: '#e53935',

  setShowGuideLines: (v) => set({ showGuideLines: v }),
  setGuideLinesColor: (c) => set({ guideLinesColor: c }),

  setPattern: (p) => {
    set({
      pattern: p,
      history: [{ grid: p.grid.slice(), paletteUsed: [...p.paletteUsed] }],
      historyIndex: 0,
      selectedColorIdx: 0,
      highlightColorIdx: null,
    })
  },

  clearPattern: () => set({ pattern: null, history: [], historyIndex: -1, highlightColorIdx: null }),

  paintCell: (x, y) => {
    const { pattern, selectedColorIdx } = get()
    if (!pattern) return
    if (selectedColorIdx >= pattern.paletteUsed.length) return  // 手绘模式：未选色时不操作
    const idx = y * pattern.width + x
    if (pattern.grid[idx] === selectedColorIdx) return  // 无变化，不入历史
    _updateGrid(get, set, (grid) => { grid[idx] = selectedColorIdx })
  },

  fillRegion: (x, y) => {
    const { pattern, selectedColorIdx } = get()
    if (!pattern) return
    if (selectedColorIdx >= pattern.paletteUsed.length) return  // 手绘模式：未选色时不操作
    const targetIdx = pattern.grid[y * pattern.width + x]
    if (targetIdx === selectedColorIdx) return

    _updateGrid(get, set, (grid) => {
      const stack = [[x, y]]
      while (stack.length) {
        const [cx, cy] = stack.pop()!
        const ci = cy * pattern.width + cx
        if (cx < 0 || cx >= pattern.width || cy < 0 || cy >= pattern.height) continue
        if (grid[ci] !== targetIdx) continue
        grid[ci] = selectedColorIdx
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
      }
    })
  },

  eraseCell: (x, y) => {
    const { pattern } = get()
    if (!pattern) return
    const idx = y * pattern.width + x
    if (pattern.grid[idx] === TRANSPARENT) return
    _updateGrid(get, set, (grid) => { grid[idx] = TRANSPARENT })
  },

  pickColor: (x, y) => {
    const { pattern } = get()
    if (!pattern) return
    const colorIdx = pattern.grid[y * pattern.width + x]
    if (colorIdx !== TRANSPARENT) set({ selectedColorIdx: colorIdx, tool: 'brush' })
  },

  // 一次性替换 grid + 色板（去背景 / 排除颜色等批量操作），推入历史可撤销
  applyGridAndPalette: (grid, paletteUsed) => {
    const { pattern, history, historyIndex, selectedColorIdx } = get()
    if (!pattern) return

    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push({ grid, paletteUsed: [...paletteUsed] })
    if (newHistory.length > MAX_HISTORY) newHistory.shift()

    set({
      pattern: { ...pattern, grid, paletteUsed, updatedAt: Date.now() },
      history: newHistory,
      historyIndex: newHistory.length - 1,
      // 色板可能缩短，防止下标越界
      selectedColorIdx: _clampColorIdx(selectedColorIdx, paletteUsed.length),
      highlightColorIdx: null,
    })
  },

  undo: () => {
    const { pattern, history, historyIndex, selectedColorIdx, highlightColorIdx } = get()
    if (!pattern || historyIndex <= 0) return
    const newIndex = historyIndex - 1
    const snap = history[newIndex]
    set({
      pattern: { ...pattern, grid: snap.grid.slice(), paletteUsed: [...snap.paletteUsed], updatedAt: Date.now() },
      historyIndex: newIndex,
      selectedColorIdx: _clampColorIdx(selectedColorIdx, snap.paletteUsed.length),
      highlightColorIdx: _restoreHighlight(highlightColorIdx, pattern.paletteUsed, snap.paletteUsed),
    })
  },

  redo: () => {
    const { pattern, history, historyIndex, selectedColorIdx, highlightColorIdx } = get()
    if (!pattern || historyIndex >= history.length - 1) return
    const newIndex = historyIndex + 1
    const snap = history[newIndex]
    set({
      pattern: { ...pattern, grid: snap.grid.slice(), paletteUsed: [...snap.paletteUsed], updatedAt: Date.now() },
      historyIndex: newIndex,
      selectedColorIdx: _clampColorIdx(selectedColorIdx, snap.paletteUsed.length),
      highlightColorIdx: _restoreHighlight(highlightColorIdx, pattern.paletteUsed, snap.paletteUsed),
    })
  },

  setTool: (tool) => set({ tool }),
  setSelectedColor: (idx) => set({ selectedColorIdx: idx }),
  setHighlightColor: (idx) => {
    const paletteLen = get().pattern?.paletteUsed.length ?? 0
    set({ highlightColorIdx: idx !== null && Number.isInteger(idx) && idx >= 0 && idx < paletteLen ? idx : null })
  },
  setScale: (scale) => set({ scale }),
  setOffset: (x, y) => set({ offsetX: x, offsetY: y }),

  setTraceImage: (path) => set({ traceImagePath: path }),

  setSelectedColorById: (colorId) => {
    const { pattern } = get()
    if (!pattern) return
    let idx = pattern.paletteUsed.indexOf(colorId)
    if (idx === -1) {
      const newPaletteUsed = [...pattern.paletteUsed, colorId]
      idx = newPaletteUsed.length - 1
      set({ pattern: { ...pattern, paletteUsed: newPaletteUsed, updatedAt: Date.now() } })
    }
    set({ selectedColorIdx: idx })
  },

  // 重命名：只改名称，不触碰撤销栈（setPattern 会重置 history）
  renamePattern: (name) => {
    const { pattern } = get()
    if (!pattern) return
    set({ pattern: { ...pattern, name, updatedAt: Date.now() } })
  },
}))

// 辅助：修改 grid 并推入历史栈
function _updateGrid(
  get: () => PatternStore,
  set: (partial: Partial<PatternStore>) => void,
  mutate: (grid: Uint16Array) => void
) {
  const { pattern, history, historyIndex } = get()
  if (!pattern) return

  const newGrid = pattern.grid.slice()
  mutate(newGrid)

  const newHistory = history.slice(0, historyIndex + 1)
  newHistory.push({ grid: newGrid, paletteUsed: [...pattern.paletteUsed] })
  if (newHistory.length > MAX_HISTORY) newHistory.shift()

  set({
    pattern: { ...pattern, grid: newGrid, updatedAt: Date.now() },
    history: newHistory,
    historyIndex: newHistory.length - 1,
  })
}

function _clampColorIdx(idx: number, paletteLen: number): number {
  return Math.max(0, Math.min(idx, paletteLen - 1))
}

function _restoreHighlight(idx: number | null, before: number[], after: number[]): number | null {
  if (idx === null) return null
  const next = after.indexOf(before[idx])
  return next >= 0 ? next : null
}
