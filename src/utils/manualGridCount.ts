import { MAX_GRID_SIDE } from './patternLimits.ts'

/** Blank means automatic; never silently truncate or reinterpret typed text. */
export function parseManualGridCount(raw: string, label: '列数' | '行数'): number | undefined {
  const value = raw.trim()
  if (value === '') return undefined
  if (!/^[0-9]+$/.test(value)) throw new Error(`${label}请输入 1–${MAX_GRID_SIDE} 的整数，不支持小数或科学计数法`)
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_GRID_SIDE) {
    throw new Error(`${label}必须在 1–${MAX_GRID_SIDE} 之间`)
  }
  return count
}
