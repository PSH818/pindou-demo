import test from 'node:test'
import assert from 'node:assert/strict'
import { STICKERS } from '../data/stickers.ts'
import { transformSticker, placeSticker, stickerDefaults } from './sticker.ts'
import { TRANSPARENT, type Pattern } from '../types/index.ts'

const pattern = (): Pattern => ({ id: 'test', name: '', width: 20, height: 20, grid: new Uint16Array(400).fill(TRANSPARENT), paletteUsed: [10], brandId: 'mard', thumbnail: '', createdAt: 1, updatedAt: 1 })

test('预置贴纸尺寸和色槽有效，旋转四次、两次翻转可还原，整数放大保留空格', () => {
  for (const s of STICKERS) {
    const original = transformSticker(s)
    assert.deepEqual(transformSticker(s, 4), original)
    assert.deepEqual(transformSticker(s, -4), original)
    assert.equal(transformSticker(s, 1).width, original.height)
    const flipped = transformSticker(s, 0, true)
    for (let y = 0; y < original.height; y++) for (let x = 0; x < original.width; x++) assert.equal(flipped.cells[y * original.width + x], original.cells[y * original.width + original.width - x - 1])
    const doubled = transformSticker(s, 0, false, false, 2)
    assert.equal(doubled.cells.filter(n => n !== TRANSPARENT).length, original.cells.filter(n => n !== TRANSPARENT).length * 4)
  }
})
test('放置不修改原图，保留透明背景，复用颜色 ID，准确统计覆盖与越界', () => {
  const p = pattern(), before = p.grid.slice()
  const pixels = { width: 2, height: 2, cells: [0, TRANSPARENT, 1, 0] }
  const r = placeSticker(p, pixels, [10, 22], 1, 1)
  assert.deepEqual(p.grid, before)
  assert.deepEqual(p.paletteUsed, [10])
  assert.deepEqual(r.paletteUsed, [10, 22])
  assert.equal(r.grid[21], 0); assert.equal(r.grid[22], TRANSPARENT); assert.equal(r.grid[41], 1)
  assert.equal(r.changed, 3); assert.equal(r.overlap, 0)
  const again = placeSticker({ ...p, ...r }, pixels, [10, 22], 1, 1)
  assert.equal(again.overlap, 3); assert.equal(again.changed, 0)
  assert.equal(placeSticker(p, pixels, [10, 22], 19, 19).outside, 2)
  assert.equal(placeSticker(p, pixels, [10, 22], -1, -1).outside, 2)
  assert.throws(() => placeSticker(p, pixels, [10], 1, 1))
  assert.throws(() => placeSticker(p, pixels, [10, 22], 1.5, 1))
})
test('默认贴纸颜色限定在当前品牌，非法变换拒绝', () => {
  const colors = [{ id: 70, code: 'A', name: '', rgb: [242, 99, 128] as [number, number, number], lab: [0, 0, 0] as [number, number, number] }]
  assert.deepEqual(stickerDefaults(STICKERS[0], colors), [70])
  assert.throws(() => stickerDefaults(STICKERS[0], []))
  assert.throws(() => transformSticker(STICKERS[0], 0, false, false, 0))
})
