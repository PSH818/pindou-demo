import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_GRID_SIDE,
  assertSafeExportCanvas,
  clampEditorGridHeight,
  isPatternCapacityReached,
  validateGridDimensions,
} from './patternLimits.ts'

test('存储容量在第 50 张时封顶', () => {
  assert.equal(isPatternCapacityReached(49), false)
  assert.equal(isPatternCapacityReached(50), true)
  assert.equal(isPatternCapacityReached(51), true)
})

test('图纸尺寸拒绝非整数和超长边', () => {
  assert.equal(validateGridDimensions(29, 29), null)
  assert.match(validateGridDimensions(29.5, 29) ?? '', /整数/)
  assert.match(validateGridDimensions(MAX_GRID_SIDE + 1, 29) ?? '', /单边/)
  assert.equal(validateGridDimensions(MAX_GRID_SIDE, MAX_GRID_SIDE), null)
})

test('极端图片比例计算出的高度被限制在安全范围', () => {
  assert.equal(clampEditorGridHeight(60, 1), 60)
  assert.equal(clampEditorGridHeight(60, 0.001), MAX_GRID_SIDE)
  assert.equal(clampEditorGridHeight(60, Number.NaN), 60)
})

test('PNG 导出在创建 Canvas 前拒绝危险像素量', () => {
  assert.doesNotThrow(() => assertSafeExportCanvas(2_000, 2_000))
  assert.throws(() => assertSafeExportCanvas(9_000, 100), /尺寸过大/)
  assert.throws(() => assertSafeExportCanvas(8_000, 8_000), /尺寸过大/)
})
