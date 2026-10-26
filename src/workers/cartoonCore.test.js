import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { convertCartoon, findSubjectBounds } from './cartoonCore.js'
import { convertPerceptual } from './perceptualCore.js'

const palette = [{ id: 7, rgb: [40, 30, 30] }, { id: 42, rgb: [255, 255, 255] }, { id: 91, rgb: [188, 188, 188] }]
const request = (src, sw, sh, w, h, options = {}) => ({ imageData: src.buffer,
  imageWidth: sw, imageHeight: sh, palette, params: { width: w, height: h, mode: 'dominant',
    dithering: false, mergeThreshold: 0, edgeEnhance: true, ...options } })
const values = r => Array.from(r.grid, i => i === 65535 ? -1 : r.paletteUsed[i])

test('经典和保真算法文件保持逐字节不变', () => {
  const hashes = {
    'imageProcessor.js': '808014c3d8dbb7928a76d1a479fe6707a0e86499c5ac861315496eb9213efd99',
    'dither.js': '0ca586ac1b8f0400a4c216235e9b8ee7030608423f7124b2ad35cc23f04b5e3f',
    'colorMatch.js': '373704cf856b25520e172f488c14be84c41d9f93a012c0f7d6d741a9eace16cd',
    'perceptualCore.js': '7fbdd2f385df68aadcc2453929ca8138881ace270cc07d4cacae189d76639051',
    'perceptualProcessor.js': '01e2ba8dd73a56acfaf92853f329640d0a466ab1f7d2efbb1673cb7c2f44e811',
  }
  for (const [file, hash] of Object.entries(hashes)) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex'), hash)
  }
})

test('细线不同色阶合并计票，保护 30% 覆盖的线条，不新增无源像素', () => {
  const src = new Uint8ClampedArray(100 * 50 * 4).fill(255)
  for (let y = 0; y < 50; y++) for (let x = 42; x < 45; x++) src.set([40 + x % 3 * 10, 30, 30, 255], (y * 100 + x) * 4)
  const msg = request(src, 100, 50, 10, 5)
  const before = src.slice()
  const ordinary = values(convertPerceptual(msg)), enhanced = values(convertCartoon(msg))
  assert.equal(ordinary.filter(i => i === 7).length, 0)
  assert.equal(enhanced.filter(i => i === 7).length, 5)
  assert.ok(enhanced.every((id, i) => (i % 10 === 4 ? id === 7 : id === 42)))
  assert.deepEqual(src, before, 'source bytes cannot be mutated')
  assert.deepEqual(convertCartoon(msg), convertCartoon(msg), 'deterministic')
})

test('弱噪点不强行加粗、关闭增强与写实模式保持基础结果', () => {
  const src = new Uint8ClampedArray(20 * 20 * 4).fill(255)
  for (let i = 0; i < 15; i++) src.set([40, 30, 30, 255], i * 4)
  const msg = request(src, 20, 20, 2, 2)
  assert.ok(values(convertCartoon(msg)).every(id => id === 42))
  for (const options of [{ edgeEnhance: false }, { mode: 'average' }]) {
    const m = request(src, 20, 20, 2, 2, options)
    assert.deepEqual(convertCartoon(m), convertPerceptual({ ...m, params: { ...m.params, edgeEnhance: false } }))
  }
})

test('透明隐藏 RGB 不生成描边，调色板索引有效，非法输入被拒绝', () => {
  const src = new Uint8ClampedArray(20 * 20 * 4)
  const msg = request(src, 20, 20, 10, 10, { subjectFocus: true, dithering: true })
  assert.ok(values(convertCartoon(msg)).every(id => id === -1))
  assert.deepEqual(convertCartoon(msg).paletteUsed, [])
  assert.throws(() => convertCartoon({ ...msg, imageData: new ArrayBuffer(0) }), /尺寸/)
  assert.throws(() => convertCartoon({ ...msg, palette: [] }), /尺寸/)
})

test('主体取景避开独立小图案；空白和同等大小双主体保持原构图', () => {
  const src = new Uint8ClampedArray(200 * 160 * 4).fill(255)
  assert.equal(findSubjectBounds(src, 200, 160), null)
  const rect = (x, y, w, h) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) src.set([40, 30, 30, 255], (yy * 200 + xx) * 4) }
  rect(20, 25, 80, 100); rect(150, 40, 20, 50)
  const bounds = findSubjectBounds(src, 200, 160)
  assert.ok(bounds.x <= 20 && bounds.y <= 25 && bounds.x + bounds.w >= 100 && bounds.y + bounds.h >= 125)
  assert.ok(bounds.x + bounds.w < 150)
  src.fill(255); rect(15, 25, 70, 100); rect(115, 25, 70, 100)
  assert.equal(findSubjectBounds(src, 200, 160), null)
})
