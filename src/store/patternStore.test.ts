import test from 'node:test'
import assert from 'node:assert/strict'
import { usePatternStore } from './patternStore.ts'
import { TRANSPARENT, type Pattern } from '../types/index.ts'

const W = 20, H = 10
const blank = (): Pattern => ({ id: 'p', name: 'p', width: W, height: H, brandId: 'mard', paletteUsed: [11, 22],
  grid: new Uint16Array(W * H).fill(TRANSPARENT), thumbnail: '', createdAt: 1, updatedAt: 1 })
const store = () => usePatternStore.getState()
const painted = () => Array.from(store().pattern!.grid).filter(v => v !== TRANSPARENT).length
function reset() { store().endStroke(); store().setPattern(blank()); store().setTool('brush') }
function drag(cells: number, row = 0) {
  store().beginStroke()
  for (let x = 0; x < cells; x++) store().paintCell(x % W, row + Math.floor(x / W))
  store().endStroke()
}

test('一笔画 50 格只占一条历史，撤销一次全部还原，重做一次全部回来', () => {
  reset()
  drag(50)
  assert.equal(painted(), 50)
  assert.equal(store().history.length, 2)
  store().undo(); assert.equal(painted(), 0)
  store().redo(); assert.equal(painted(), 50)
})

test('连画 40 笔后，最近 29 笔都还能逐笔撤销', () => {
  reset()
  for (let i = 0; i < 40; i++) { store().beginStroke(); store().paintCell(i % W, Math.floor(i / W)); store().paintCell(i % W, 5 + Math.floor(i / W)); store().endStroke() }
  assert.equal(painted(), 80)
  for (let i = 0; i < 29; i++) store().undo()
  assert.equal(painted(), 80 - 29 * 2)
})

test('笔内只在第一格和收笔时各通知一次订阅者，单击一格只通知一次', () => {
  reset()
  let calls = 0
  const off = usePatternStore.subscribe(() => { calls++ })
  drag(30)
  assert.equal(calls, 2)
  calls = 0
  drag(1, 5)
  assert.equal(calls, 1)
  off()
})

test('收笔后图纸对象更新，自动保存能看到整笔结果', () => {
  reset()
  store().beginStroke()
  store().paintCell(0, 0)
  const afterFirst = store().pattern
  store().paintCell(1, 0)
  assert.equal(store().pattern, afterFirst, '笔内不换对象')
  store().endStroke()
  assert.notEqual(store().pattern, afterFirst)
  assert.equal(painted(), 2)
})

test('橡皮按笔撤销，擦空格不产生历史', () => {
  reset()
  drag(10)
  store().beginStroke()
  for (let x = 0; x < W; x++) store().eraseCell(x, 0)
  store().eraseCell(0, 9)
  store().endStroke()
  assert.equal(painted(), 0)
  assert.equal(store().history.length, 3)
  store().undo(); assert.equal(painted(), 10)
  store().beginStroke(); store().eraseCell(0, 9); store().endStroke()
  assert.equal(store().history.length, 3, '没有实际改动的一笔不入历史')
})

test('笔中途撤销后继续画，不改写已有的历史快照', () => {
  reset()
  store().beginStroke()
  store().paintCell(0, 0); store().paintCell(1, 0)
  store().undo()
  assert.equal(painted(), 0)
  store().paintCell(2, 0); store().paintCell(3, 0)
  store().endStroke()
  assert.equal(painted(), 2)
  store().undo()
  assert.equal(painted(), 0, '初始快照没有被原地写入污染')
  store().redo()
  assert.deepEqual([0, 1, 2, 3].map(x => store().pattern!.grid[x] !== TRANSPARENT), [false, false, true, true])
})

test('笔中途追加新颜色后，撤销重做的色板与网格保持一致', () => {
  reset()
  store().beginStroke()
  store().paintCell(0, 0); store().paintCell(1, 0)
  store().setSelectedColorById(33)
  store().paintCell(2, 0); store().paintCell(3, 0)
  store().endStroke()
  for (const step of ['undo', 'redo', 'undo', 'undo', 'redo', 'redo'] as const) {
    store()[step]()
    const { grid, paletteUsed } = store().pattern!
    assert.ok(Array.from(grid).every(v => v === TRANSPARENT || v < paletteUsed.length), `${step} 后下标不越界`)
  }
  assert.equal(store().pattern!.paletteUsed[store().pattern!.grid[3]], 33)
})

test('不在笔内直接调用时，每次改动仍各占一条历史', () => {
  reset()
  store().paintCell(0, 0); store().paintCell(1, 0); store().paintCell(1, 0)
  assert.equal(store().history.length, 3)
})
