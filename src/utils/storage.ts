import { openDB, type IDBPDatabase } from 'idb'
import { isBrandId, TRANSPARENT, type Pattern, type PatternMeta } from '../types'
import { MAX_SAVED_PATTERNS, assertGridDimensions, isPatternCapacityReached } from './patternLimits'
import { PatternConflictError, clonePattern, patternVersion } from './patternPersistence'

// ── DB 初始化 ────────────────────────────────────────────────

const DB_NAME      = 'pindou'
const DB_VERSION   = 1
export class PatternCapacityError extends Error {
  constructor() {
    super(`本地最多保存 ${MAX_SAVED_PATTERNS} 张图纸，请先删除旧图纸`)
    this.name = 'PatternCapacityError'
  }
}

let _db: IDBPDatabase | null = null

async function getDB(): Promise<IDBPDatabase> {
  if (_db) return _db
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // patterns: 完整图纸数据（含 Uint16Array grid）
      db.createObjectStore('patterns', { keyPath: 'id' })
      // meta: 仅元数据（不含 grid），用于列表展示，避免加载大对象
      db.createObjectStore('meta', { keyPath: 'id' })
    },
  })
  return _db
}

// ── 公开 API ────────────────────────────────────────────────

/**
 * 保存图纸。同一事务同步写入 patterns（含 grid）和 meta（不含 grid）。
 * Uint16Array 由 IndexedDB 结构化克隆直接存储，无需序列化。
 */
export async function savePattern(input: Pattern, expected: Pattern | null = null): Promise<void> {
  assertPattern(input)
  const pattern = clonePattern(input)
  const expectedVersion = expected ? patternVersion(expected) : null
  const db = await getDB()
  const tx = db.transaction(['patterns', 'meta'], 'readwrite')
  // Observe transaction rejection immediately, and abort on synchronous failures
  // too (e.g. quota/serialization errors after the first store has been written).
  const completed = tx.done.catch(error => error as Error)
  try {
    const patterns = tx.objectStore('patterns')
    const existing = await patterns.get(pattern.id) as Pattern | undefined
    if (existing ? expectedVersion !== patternVersion(existing) : expectedVersion !== null) throw new PatternConflictError()
    if (!existing && isPatternCapacityReached(await patterns.count())) throw new PatternCapacityError()
    if (!existing || patternVersion(existing) !== patternVersion(pattern)) {
      await patterns.put(pattern)
      const { grid: _grid, ...meta } = pattern
      await tx.objectStore('meta').put(meta)
    }
    const failure = await completed
    if (failure) throw failure
  } catch (error) {
    try { tx.abort() } catch { /* Already aborted/finished. */ }
    await completed
    throw error
  }
}

/** Add new versions atomically: never overwrite existing work or save only half a pair. */
export async function saveNewPatterns(items: Pattern[]): Promise<void> {
  items.forEach(assertPattern)
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('图纸标识重复')
  const db = await getDB()
  const tx = db.transaction(['patterns', 'meta'], 'readwrite')
  // Attach immediately so transaction failures cannot become unhandled rejections.
  const completed = tx.done.catch(error => error as Error)
  try {
    const store = tx.objectStore('patterns')
    if (await store.count() + items.length > MAX_SAVED_PATTERNS) throw new PatternCapacityError()
    for (const item of items) {
      await store.add(item)
      const { grid: _grid, ...meta } = item
      await tx.objectStore('meta').add(meta)
    }
    const failure = await completed
    if (failure) throw failure
  } catch (error) {
    try { tx.abort() } catch { /* Already aborted/finished. */ }
    await completed
    throw error
  }
}

/** 获取元数据列表（不含 grid），按最新更新时间降序排列 */
export async function listPatterns(): Promise<PatternMeta[]> {
  const db = await getDB()
  const all = (await db.getAll('meta')) as PatternMeta[]
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 获取完整图纸（含 grid）。grid 从 IndexedDB 取出时已是 Uint16Array，无需还原。 */
export async function getPattern(id: string): Promise<Pattern | null> {
  const db = await getDB()
  const raw = await db.get('patterns', id)
  if (raw === undefined) return null
  assertPattern(raw)
  return raw
}

/** 删除图纸。同一事务同步删除 patterns 和 meta。 */
export async function deletePattern(id: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['patterns', 'meta'], 'readwrite')
  const completed = tx.done.catch(error => error as Error)
  try {
    await tx.objectStore('patterns').delete(id)
    await tx.objectStore('meta').delete(id)
    const failure = await completed
    if (failure) throw failure
  } catch (error) {
    try { tx.abort() } catch { /* Already aborted/finished. */ }
    await completed
    throw error
  }
}

/** 检查存储容量（仅统计条目数，IndexedDB 无 5 MB 硬限制） */
export async function checkCapacity(): Promise<{ count: number; isFull: boolean }> {
  const db = await getDB()
  const count = await db.count('patterns')
  return { count, isFull: isPatternCapacityReached(count) }
}

function assertPattern(value: unknown): asserts value is Pattern {
  if (!value || typeof value !== 'object') throw new Error('图纸数据已损坏')
  const pattern = value as Partial<Pattern>
  if (!isBrandId(pattern.brandId)) throw new Error('图纸使用的品牌色板当前不可用')
  if (!Number.isInteger(pattern.width) || !Number.isInteger(pattern.height) ||
      (pattern.width ?? 0) < 1 || (pattern.height ?? 0) < 1) {
    throw new Error('图纸尺寸无效')
  }
  assertGridDimensions(pattern.width!, pattern.height!)
  if (!(pattern.grid instanceof Uint16Array) ||
      pattern.grid.length !== pattern.width! * pattern.height!) {
    throw new Error('图纸网格数据已损坏')
  }
  if (!Array.isArray(pattern.paletteUsed) ||
      pattern.paletteUsed.some(id => !Number.isInteger(id) || id < 0)) {
    throw new Error('图纸色板数据已损坏')
  }
  for (const value of pattern.grid) {
    if (value !== TRANSPARENT && value >= pattern.paletteUsed.length) {
      throw new Error('图纸颜色索引已损坏')
    }
  }
}
