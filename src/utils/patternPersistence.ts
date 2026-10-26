import type { Pattern } from '../types/index.ts'

export class PatternConflictError extends Error {
  constructor() {
    super('图纸已在其他页面修改或删除，自动保存已暂停。当前修改仍保留在此页面，请另存副本或重新读取。')
    this.name = 'PatternConflictError'
  }
}

/** Exact snapshot, including metadata: no timestamp ordering or hash collision. */
export function patternVersion(p: Pattern): string {
  return JSON.stringify([p.id, p.name, p.width, p.height, p.brandId, p.paletteUsed,
    Array.from(p.grid), p.thumbnail, p.createdAt, p.updatedAt,
    p.conversionAlgorithm, p.conversionVersion, p.conversionParams])
}

export function clonePattern(p: Pattern): Pattern {
  return { ...p, grid: p.grid.slice(), paletteUsed: [...p.paletteUsed],
    ...(p.conversionParams ? { conversionParams: { ...p.conversionParams } } : {}) }
}

/** One editor session serializes its writes; each uses the last committed base. */
export class PatternSaveSession {
  private base: Pattern
  private tail: Promise<void> = Promise.resolve()
  private conflict: PatternConflictError | null = null
  private write: (next: Pattern, expected: Pattern) => Promise<void>
  constructor(initial: Pattern, write: (next: Pattern, expected: Pattern) => Promise<void>) {
    this.base = clonePattern(initial)
    this.write = write
  }
  get id(): string { return this.base.id }
  isDirty(p: Pattern): boolean { return patternVersion(p) !== patternVersion(this.base) }
  save(p: Pattern): Promise<void> {
    const next = clonePattern(p)
    const task = this.tail.then(async () => {
      if (this.conflict) throw this.conflict
      if (next.id !== this.base.id) throw new Error('图纸保存会话不匹配')
      try {
        await this.write(next, this.base)
        this.base = next
      } catch (error) {
        if (error instanceof PatternConflictError) this.conflict = error
        throw error
      }
    })
    this.tail = task.catch(() => {})
    return task
  }
}
