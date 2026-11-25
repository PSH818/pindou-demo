import test from 'node:test'
import assert from 'node:assert/strict'
import { parseConversionResult } from './conversionRunner.ts'
import { TRANSPARENT as T, type BeadColor } from '../types/index.ts'

const palette = [10, 20, 30].map(id => ({ id, code: `C${id}`, name: '', rgb: [0, 0, 0], lab: [0, 0, 0] }) as BeadColor)
const buffer = (...cells: number[]) => new Uint16Array(cells).buffer

test('合法的 Worker 结果被原样解析', () => {
  const out = parseConversionResult({ grid: buffer(0, 1, T, 1), paletteUsed: [20, 10] }, 2, 2, palette)!
  assert.deepEqual(Array.from(out.grid), [0, 1, T, 1])
  assert.deepEqual(out.paletteUsed, [20, 10])
})

test('格数不符、色号不在色板里、下标越界、缺字段的结果一律拒绝', () => {
  assert.equal(parseConversionResult({ grid: buffer(0, 0, 0), paletteUsed: [10] }, 2, 2, palette), null, '格数不符')
  assert.equal(parseConversionResult({ grid: buffer(0, 0, 0, 0), paletteUsed: [99] }, 2, 2, palette), null, '未知色号')
  assert.equal(parseConversionResult({ grid: buffer(0, 1, 0, 0), paletteUsed: [10] }, 2, 2, palette), null, '下标越界')
  assert.equal(parseConversionResult({ grid: buffer(0, 0, 0, 0) }, 2, 2, palette), null, '缺色板')
  assert.equal(parseConversionResult({ paletteUsed: [10] }, 2, 2, palette), null, '缺网格')
  assert.equal(parseConversionResult({ grid: [0, 0, 0, 0] as unknown as ArrayBuffer, paletteUsed: [10] }, 2, 2, palette), null, '网格不是 ArrayBuffer')
})

test('全透明图纸配空色板是合法结果', () => {
  assert.ok(parseConversionResult({ grid: buffer(T, T), paletteUsed: [] }, 2, 1, palette))
})
