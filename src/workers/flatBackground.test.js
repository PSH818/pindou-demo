import test from 'node:test'
import assert from 'node:assert/strict'
import { removeFlatBackground } from './flatBackground.js'

function fixture(bg = [190, 245, 238]) {
  const w = 120, h = 120, src = new Uint8ClampedArray(w * h * 4)
  const put = (x, y, c) => src.set(c.length === 4 ? c : [...c, 255], (y * w + x) * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, bg)
  for (let y = 25; y < h; y++) for (let x = 28; x <= 92; x++) {
    put(x, y, x < 32 || x > 88 || y < 29 ? [30, 5, 0] : [255, 245, 205])
  }
  return { src, w, h, put, pixel: (data, x, y) => Array.from(data.slice((y * w + x) * 4, (y * w + x) * 4 + 4)) }
}

test('移除外部浅色背景，保留触底身体、深色描边和原图像素', () => {
  const f = fixture(), before = f.src.slice()
  const result = removeFlatBackground(f.src, f.w, f.h)
  assert.ok(result)
  assert.equal(f.pixel(result.rgba, 10, 60)[3], 0)
  for (const [x, y] of [[60, 119], [80, 105], [29, 60]]) assert.deepEqual(f.pixel(result.rgba, x, y), f.pixel(f.src, x, y))
  assert.deepEqual(f.src, before)
})

test('白色背景不能删除被描边包围且触底的同色身体、眼睛高光', () => {
  const f = fixture([255, 255, 255])
  for (let y = 29; y < f.h; y++) for (let x = 32; x <= 88; x++) f.put(x, y, [255, 255, 255])
  const result = removeFlatBackground(f.src, f.w, f.h)
  assert.ok(result)
  assert.equal(f.pixel(result.rgba, 10, 60)[3], 0)
  assert.equal(f.pixel(result.rgba, 60, 119)[3], 255)
})

test('混合边缘去底色并降低 alpha，而不侵蚀实心轮廓', () => {
  const f = fixture()
  for (let y = 30; y < 110; y++) f.put(27, y, [110, 125, 119])
  const result = removeFlatBackground(f.src, f.w, f.h)
  const edge = f.pixel(result.rgba, 27, 60)
  assert.ok(edge[3] > 90 && edge[3] < 170)
  assert.ok(edge[1] < 20 && edge[2] < 20)
  assert.deepEqual(f.pixel(result.rgba, 29, 60), [30, 5, 0, 255])
})

test('保留已有透明度，拒绝全空白或角落颜色不一致的复杂场景', () => {
  const f = fixture(); f.put(60, 50, [50, 20, 30, 0]); f.put(60, 51, [50, 20, 30, 90])
  const result = removeFlatBackground(f.src, f.w, f.h)
  assert.equal(f.pixel(result.rgba, 60, 50)[3], 0)
  assert.equal(f.pixel(result.rgba, 60, 51)[3], 90)
  assert.equal(removeFlatBackground(new Uint8ClampedArray(120 * 120 * 4).fill(255), 120, 120), null)
  for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) f.put(x, y, [x * 2, y * 2, (x + y) % 256])
  assert.equal(removeFlatBackground(f.src, 120, 120), null)
})
