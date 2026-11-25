import test from 'node:test'
import assert from 'node:assert/strict'
import { compactPalette, countByColorId, excludeColor, removeEdgeBackground } from './patternOps.ts'
import { TRANSPARENT as T, type BeadColor } from '../types/index.ts'

const bead = (id: number, lab: [number, number, number]): BeadColor => ({ id, code: `C${id}`, name: '', rgb: [0, 0, 0], lab })
const ids = (grid: Uint16Array, paletteUsed: number[]) => Array.from(grid, v => v === T ? -1 : paletteUsed[v])

test('按色号计数：跳过透明格，顺序为首次出现的顺序', () => {
  const counts = countByColorId(new Uint16Array([1, T, 0, 1, 1]), [10, 20, 30])
  assert.deepEqual([...counts], [[20, 3], [10, 1]])
})

test('收紧色板：去掉没用到的颜色并重排下标，不修改传入的数组', () => {
  const grid = new Uint16Array([2, T, 0, 2]), palette = [10, 20, 30]
  const result = compactPalette(grid, palette)
  assert.deepEqual(result.paletteUsed, [10, 30])
  assert.deepEqual(Array.from(result.grid), [1, T, 0, 1])
  assert.deepEqual(Array.from(grid), [2, T, 0, 2]); assert.deepEqual(palette, [10, 20, 30])
})

test('去背景：只清掉与边缘连通的背景色，被主体包住的同色格保留', () => {
  // 0 = 背景色，1 = 主体；中心的 0 被主体围住
  const grid = new Uint16Array([
    0, 0, 0, 0, 0,
    0, 1, 1, 1, 0,
    0, 1, 0, 1, 0,
    0, 1, 1, 1, 0,
    0, 0, 0, 0, 0,
  ])
  const result = removeEdgeBackground(grid, 5, 5, [10, 20])!
  assert.deepEqual(ids(result.grid, result.paletteUsed), [
    -1, -1, -1, -1, -1,
    -1, 20, 20, 20, -1,
    -1, 20, 10, 20, -1,
    -1, 20, 20, 20, -1,
    -1, -1, -1, -1, -1,
  ])
  assert.equal(grid[0], 0, '不修改传入的网格')
})

test('去背景：背景色被清光后从色板移除；边缘全透明时不处理', () => {
  const result = removeEdgeBackground(new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, 0]), 3, 3, [10, 20])!
  assert.deepEqual(result.paletteUsed, [20])
  assert.deepEqual(ids(result.grid, result.paletteUsed), [-1, -1, -1, -1, 20, -1, -1, -1, -1])
  assert.equal(removeEdgeBackground(new Uint16Array([T, T, T, T, 0, T, T, T, T]), 3, 3, [10]), null)
})

test('去背景：边缘颜色并列时取色板下标较小的；单行单列图纸不越界', () => {
  const tie = removeEdgeBackground(new Uint16Array([1, 0, 0, 1]), 2, 2, [10, 20])!
  assert.deepEqual(ids(tie.grid, tie.paletteUsed), [20, -1, -1, 20])
  const row = removeEdgeBackground(new Uint16Array([0, 0, 1, 0]), 4, 1, [10, 20])!
  assert.deepEqual(ids(row.grid, row.paletteUsed), [-1, -1, 20, -1])
  const column = removeEdgeBackground(new Uint16Array([1, 0, 0]), 1, 3, [10, 20])!
  assert.deepEqual(ids(column.grid, column.paletteUsed), [20, -1, -1])
})

test('排除颜色：换成图纸里 Lab 最近的另一种颜色，并从色板移除', () => {
  const colors = [bead(10, [50, 0, 0]), bead(20, [52, 1, 0]), bead(30, [90, 0, 0])]
  const grid = new Uint16Array([0, 1, 2, T, 0])
  const result = excludeColor(grid, [10, 20, 30], 10, colors)!
  assert.deepEqual(result.paletteUsed, [20, 30])
  assert.deepEqual(ids(result.grid, result.paletteUsed), [20, 20, 30, -1, 20])
  assert.equal(result.excluded.code, 'C10')
  assert.deepEqual(Array.from(grid), [0, 1, 2, T, 0], '不修改传入的网格')
})

test('排除颜色：没有可替换的颜色、图纸里没有该颜色、色板缺少该色号时都不处理', () => {
  const colors = [bead(10, [50, 0, 0]), bead(20, [52, 1, 0])]
  assert.equal(excludeColor(new Uint16Array([0, 0]), [10], 10, colors), null)
  assert.equal(excludeColor(new Uint16Array([0, 0]), [10], 20, colors), null)
  assert.equal(excludeColor(new Uint16Array([0, 1]), [10, 99], 99, colors), null)
  // 色板里有但品牌色表里查不到的颜色不能作为替换目标
  assert.equal(excludeColor(new Uint16Array([0, 1]), [10, 99], 10, colors), null)
})
