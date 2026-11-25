import test from 'node:test'
import assert from 'node:assert/strict'
import { convertCartoon, frameSubject } from './cartoonCore.js'
import { convertPerceptual } from './perceptualCore.js'

// 保真模式的 Worker 入口只负责分流和取景，结果必须与直接调用核心函数完全一致
const messages = []
globalThis.self = { postMessage: message => messages.push(message) }
await import('./faithfulProcessor.js')

const palette = [{ id: 7, rgb: [40, 30, 30] }, { id: 42, rgb: [255, 255, 255] }, { id: 91, rgb: [188, 188, 188] }, { id: 150, rgb: [220, 40, 40] }]
function request(algorithm, options = {}) {
  const w = 60, h = 40, src = new Uint8ClampedArray(w * h * 4).fill(255)
  for (let y = 8; y < 30; y++) for (let x = 18; x < 44; x++) src.set(x === 18 || x === 43 || y === 8 || y === 29 ? [40, 30, 30, 255] : [220, 40, 40, 255], (y * w + x) * 4)
  return { type: 'convert', imageData: src.buffer, imageWidth: w, imageHeight: h, palette,
    params: { algorithm, width: 15, height: 10, mode: 'dominant', dithering: false, mergeThreshold: 0, edgeEnhance: true, ...options } }
}
function run(message) {
  messages.length = 0
  globalThis.self.onmessage({ data: message })
  return messages.find(m => m.type !== 'progress')
}
const same = (reply, expected) => {
  assert.equal(reply.type, 'result')
  assert.deepEqual(Array.from(new Uint16Array(reply.grid)), Array.from(expected.grid))
  assert.deepEqual(reply.paletteUsed, expected.paletteUsed)
}

test('轮廓增强走 convertCartoon，普通保真走 convertPerceptual', () => {
  same(run(request('cartoon-v1')), convertCartoon(request('cartoon-v1')))
  same(run(request('perceptual-v1')), convertPerceptual(request('perceptual-v1')))
  assert.notDeepEqual(Array.from(convertCartoon(request('cartoon-v1')).grid), Array.from(convertPerceptual(request('perceptual-v1')).grid), '用例要能区分两条路径')
})

test('主体优先：两条路径都先取景再转换', () => {
  const focus = { subjectFocus: true }
  same(run(request('perceptual-v1', focus)), convertPerceptual(frameSubject(request('perceptual-v1', focus))))
  same(run(request('cartoon-v1', focus)), convertCartoon(request('cartoon-v1', focus)))
})

test('图像尺寸与数据长度不符时返回错误消息，不抛到 Worker 外', () => {
  const broken = { ...request('perceptual-v1'), imageWidth: 61 }
  assert.deepEqual(run(broken), { type: 'error', error: '图像尺寸无效' })
  assert.equal(run({ type: 'other' }), undefined)
})
