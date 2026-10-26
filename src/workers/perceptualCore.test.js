import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import { convertPerceptual, toOklab } from './perceptualCore.js'
import { floydSteinberg } from './dither.js'
import { rgb2lab } from './colorMatch.js'

const bead = (id, rgb) => ({ id, rgb, lab: rgb2lab(...rgb), code: String(id), name: String(id) })
const palette = [bead(7, [0, 0, 0]), bead(42, [255, 255, 255]), bead(91, [188, 188, 188]), bead(150, [255, 0, 0])]
const request = (pixels, sw, sh, w = sw, h = sh, options = {}, colors = palette) => ({
  type: 'convert', imageData: new Uint8ClampedArray(pixels).buffer, imageWidth: sw, imageHeight: sh,
  palette: colors, params: { width: w, height: h, mode: 'dominant', mergeThreshold: 0, dithering: false, ...options },
})
const ids = result => Array.from(result.grid, i => i === 65535 ? -1 : result.paletteUsed[i])

test('原算法及两个依赖文件逐字节保持不变', () => {
  const hashes = {
    'imageProcessor.js': '808014c3d8dbb7928a76d1a479fe6707a0e86499c5ac861315496eb9213efd99',
    'dither.js': '0ca586ac1b8f0400a4c216235e9b8ee7030608423f7124b2ad35cc23f04b5e3f',
    'colorMatch.js': '373704cf856b25520e172f488c14be84c41d9f93a012c0f7d6d741a9eace16cd',
  }
  for (const [name, expected] of Object.entries(hashes)) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(name, import.meta.url))).digest('hex'), expected)
  }
})

test('Oklab 标准黑白与红色坐标', () => {
  assert.deepEqual(toOklab([0, 0, 0]), [0, 0, 0])
  assert.ok(Math.abs(toOklab([255, 255, 255])[0] - 1) < 0.000001)
  const red = toOklab([255, 0, 0])
  assert.ok(Math.abs(red[0] - 0.627955) < 0.000001)
  assert.ok(Math.abs(red[1] - 0.224863) < 0.000001)
})

test('不连续珠子 ID、精确色与全透明图片均正确返回', () => {
  assert.deepEqual(ids(convertPerceptual(request([255, 0, 0, 255, 0, 0, 0, 255], 2, 1))), [150, 7])
  for (const mode of ['dominant', 'average']) {
    const result = convertPerceptual(request(new Array(16).fill(0), 2, 2, 2, 2, { mode, dithering: true }))
    assert.deepEqual(ids(result), [-1, -1, -1, -1])
    assert.deepEqual(result.paletteUsed, [])
  }
})

test('面积采样不会让非整数边界两侧像素重复获得完整权重', () => {
  const message = request([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255], 3, 1, 2, 1)
  assert.deepEqual(ids(convertPerceptual(message)), [7, 42])
})

test('线性光均值保留黑白混合的实际亮度，透明 RGB 不污染结果', () => {
  assert.deepEqual(ids(convertPerceptual(request([0, 0, 0, 255, 255, 255, 255, 255], 2, 1, 1, 1, { mode: 'average' }))), [91])
  assert.deepEqual(ids(convertPerceptual(request([0, 0, 0, 0, 255, 0, 0, 255], 2, 1, 1, 1, { mode: 'average' }))), [150])
})

test('最高合并强度仍保留孤立的黑色眼睛', () => {
  const pixels = Array.from({ length: 25 }, (_, i) => i === 12 ? [0, 0, 0, 255] : [255, 255, 255, 255]).flat()
  const result = ids(convertPerceptual(request(pixels, 5, 5, 5, 5, { mergeThreshold: 100 })))
  assert.equal(result[12], 7)
  assert.equal(result.filter(id => id === 7).length, 1)
})

test('卡通轮廓保护保留跨格边界的深色细线，写实模式不强行加粗', () => {
  const pixels = [0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]
  assert.deepEqual(ids(convertPerceptual(request(pixels, 5, 1, 1, 1, { edgeEnhance: true }))), [7])
  assert.deepEqual(ids(convertPerceptual(request(pixels, 5, 1, 1, 1, { edgeEnhance: false }))), [42])
  assert.deepEqual(ids(convertPerceptual(request(pixels, 5, 1, 1, 1, { edgeEnhance: true, mode: 'average' }))), [91])
})

test('抖动透明边界与重复执行稳定性', () => {
  const pixels = Array.from({ length: 64 }, (_, i) => [i * 4, i * 4, i * 4, i % 8 === 4 ? 0 : 255]).flat()
  const msg = request(pixels, 8, 8, 8, 8, { dithering: true, mode: 'average' })
  const a = convertPerceptual(msg), b = convertPerceptual(msg)
  assert.deepEqual(a, b)
  assert.ok(ids(a).every((id, i) => i % 8 === 4 ? id === -1 : id >= 0))
  assert.equal(new Set(a.grid).size - 1, a.paletteUsed.length)
})

test('新旧两套入口都遵守相同结果协议（直接执行原文件）', () => {
  const msg = request([255, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 255], 2, 2)
  let legacy
  const self = { postMessage: data => { if (data.type === 'result') legacy = data } }
  const code = readFileSync(new URL('./imageProcessor.js', import.meta.url), 'utf8')
    .replace("import { floydSteinberg } from './dither.js'", '')
  vm.runInNewContext(code, { self, floydSteinberg, Uint8ClampedArray, Uint16Array, Uint8Array, Int32Array, Uint32Array })
  self.onmessage({ data: msg })
  assert.deepEqual(ids({ grid: new Uint16Array(legacy.grid), paletteUsed: legacy.paletteUsed }), [150, -1, 42, 7])
  assert.deepEqual(ids(convertPerceptual(msg)), [150, -1, 42, 7])
})

test('拒绝无效输入与空色板', () => {
  assert.throws(() => convertPerceptual(request([], 1, 1)), /尺寸/)
  assert.throws(() => convertPerceptual(request([0, 0, 0, 255], 1, 1, 1, 1, {}, [])), /色板/)
})
