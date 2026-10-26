import test from 'node:test'
import assert from 'node:assert/strict'
import { assertMakingProgress, boardTiles, makingSignature, materialItems, printPlan, tilePattern } from './making.ts'
import { TRANSPARENT, type Pattern, type BeadColor } from '../types/index.ts'
const colors: BeadColor[] = Array.from({ length: 65 }, (_, id) => ({ id: id + 10, code: `C${id}`, name: '', rgb: [id, id, id], lab: [0, 0, 0] }))
const pattern: Pattern = { id: 'p', name: 'p', width: 60, height: 63, brandId: 'mard', paletteUsed: colors.map(c => c.id), grid: Uint16Array.from({ length: 3780 }, (_, i) => i % 11 ? i % 65 : TRANSPARENT), thumbnail: '', createdAt: 1, updatedAt: 1 }

test('用料统计排除透明、保留全部色号，不静默丢失未知颜色', () => {
  const rows = materialItems(pattern, colors)
  assert.equal(rows.length, 65)
  assert.equal(rows.reduce((s, i) => s + i.count, 0), pattern.grid.filter(v => v !== TRANSPARENT).length)
  assert.equal(materialItems({ ...pattern, grid: new Uint16Array(3780).fill(TRANSPARENT) }, colors).length, 0)
  assert.throws(() => materialItems(pattern, []), /未知色号/)
  assert.throws(() => materialItems({ ...pattern, grid: new Uint16Array(1) }, colors), /格数/)
})
test('制作签名忽略名称和更新时间、色板重排，但捕获一格、尺寸和品牌变动', () => {
  const key = makingSignature(pattern)
  assert.equal(makingSignature({ ...pattern, name: 'new', updatedAt: 100 }), key)
  assert.equal(makingSignature({ ...pattern, paletteUsed: [...pattern.paletteUsed].reverse(), grid: pattern.grid.map(v => v === TRANSPARENT ? v : 64 - v) }), key)
  const changed = pattern.grid.slice(); changed[0] = 1
  assert.notEqual(makingSignature({ ...pattern, grid: changed }), key)
  assert.notEqual(makingSignature({ ...pattern, width: 63, height: 60 }), key)
  assert.notEqual(makingSignature({ ...pattern, brandId: 'coco' }), key)
})
test('分块可无损拼合，末行末列不补珠，每格只出现一次，原图不变', () => {
  for (const [columns, rows] of [[29, 29], [20, 50], [200, 200], [1, 1], [31, 17]]) {
    const output = new Uint16Array(pattern.grid.length), visits = new Uint8Array(pattern.grid.length)
    const original = pattern.grid.slice()
    for (const t of boardTiles(pattern.width, pattern.height, columns, rows)) {
      const part = tilePattern(pattern, t)
      for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) {
        const index = (t.y + y) * pattern.width + t.x + x
        output[index] = part.grid[y * t.width + x]; visits[index]++
      }
      part.grid.fill(0)
    }
    assert.deepEqual(output, original); assert.ok(visits.every(v => v === 1)); assert.deepEqual(pattern.grid, original)
  }
  for (const n of [0, -1, 201, 1.5, NaN, Infinity]) assert.throws(() => boardTiles(60, 63, n, 29), /整数/)
})
test('用料多页完整覆盖、空图可导出，超大页数预先拒绝', () => {
  const whole = printPlan(pattern, colors, { mode: 'whole', columns: 29, rows: 29 })
  assert.equal(whole.materialPages, 3); assert.equal(whole.pageCount, 4)
  const split = printPlan(pattern, colors, { mode: 'boards', columns: 29, rows: 29 })
  assert.equal(split.tiles.length, 9); assert.equal(split.pageCount, 13)
  assert.throws(() => printPlan(pattern, colors, { mode: 'boards', columns: 1, rows: 1 }), /200 页/)
  assert.equal(printPlan({ ...pattern, grid: pattern.grid.map(() => TRANSPARENT) }, colors, { mode: 'whole', columns: 29, rows: 29 }).pageCount, 2)
})
test('制作进度契约拒绝损坏数据与重复标记', () => {
  const p = { version: 1, patternId: 'p', signature: makingSignature(pattern), revision: 1, completedColorIds: [10, 20], updatedAt: 1 }
  assert.doesNotThrow(() => assertMakingProgress(p))
  for (const bad of [null, { ...p, revision: 0 }, { ...p, completedColorIds: [10, 10] }, { ...p, completedColorIds: [-1] }, { ...p, updatedAt: NaN }]) assert.throws(() => assertMakingProgress(bad))
})
