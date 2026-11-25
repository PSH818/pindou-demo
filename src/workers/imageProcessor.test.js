import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

// 经典算法的结果锁：固定输入必须得到固定输出。
// 锁的是转换结果而不是文件字节，所以可以整理代码，但不能改变任何一格的颜色。

const messages = []
globalThis.self = { postMessage: message => messages.push(message) }
await import('./imageProcessor.js')
const { rgb2lab } = await import('./colorMatch.js')

// 确定性伪随机数，保证每次运行输入一致
function lcg(seed) {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
}

const palette = (() => {
  const rnd = lcg(7)
  return Array.from({ length: 96 }, (_, i) => {
    const rgb = [rnd() * 256 | 0, rnd() * 256 | 0, rnd() * 256 | 0]
    return { id: i * 3 + 5, rgb, lab: rgb2lab(...rgb) }
  })
})()

// 渐变 + 色块 + 噪点 + 透明角，覆盖主色、均值、合并和抖动各条路径
function sourceImage(w, h) {
  const rnd = lcg(42), src = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, block = ((x / 23 | 0) + (y / 17 | 0)) % 3
    src[i]     = block === 0 ? x * 255 / w : block === 1 ? 220 : rnd() * 256
    src[i + 1] = block === 0 ? y * 255 / h : block === 1 ? 60 + (x % 9) : rnd() * 256
    src[i + 2] = block === 0 ? 255 - x * 255 / w : block === 1 ? 40 : rnd() * 256
    src[i + 3] = x + y < 30 ? 0 : x + y < 40 ? 120 : 255
  }
  return src
}

function convert(params, w = 160, h = 120) {
  messages.length = 0
  globalThis.self.onmessage({ data: { type: 'convert', imageData: sourceImage(w, h).buffer, imageWidth: w, imageHeight: h, palette, params } })
  const result = messages.find(m => m.type === 'result')
  assert.ok(result, messages.find(m => m.type === 'error')?.error ?? '没有返回结果')
  return createHash('sha256').update(new Uint8Array(result.grid)).update(JSON.stringify(result.paletteUsed)).digest('hex')
}

const cases = {
  '主色 40×30':            [{ width: 40, height: 30, mode: 'dominant', dithering: false, mergeThreshold: 30 }, '8c4bdc10fdce050641d241602123eb4ee89b9a4ca99967fb8a6ba18fff735020'],
  '主色 不合并 29×31':      [{ width: 29, height: 31, mode: 'dominant', dithering: false, mergeThreshold: 0 }, '9c7542cc009e0e54236508f0d72b685737e9618913a75875bd5a6720105386d8'],
  '均值 40×30':            [{ width: 40, height: 30, mode: 'average', dithering: false, mergeThreshold: 30 }, '32576efca625addc1512b05ae4f656ec80c1f3c6a76332d181f16d48c9bf8b81'],
  '均值 强合并 64×48':      [{ width: 64, height: 48, mode: 'average', dithering: false, mergeThreshold: 80 }, '9ce39212a4304e9420deb732c8dbb1684ddc8cbe939135cdd734394b929c217f'],
  '主色 抖动 40×30':        [{ width: 40, height: 30, mode: 'dominant', dithering: true, mergeThreshold: 30 }, '356e59f2e85d0425dc2c2cfe0e394031f3242d1ea0a973c9c20d9579c64f1120'],
  '均值 抖动 53×37':        [{ width: 53, height: 37, mode: 'average', dithering: true, mergeThreshold: 15 }, '3c2e3dacb48292b0a178230b29fb293e1a5b8cc1c66b871a5a4c56cc6a5d07c9'],
  '放大（格数多于像素）':    [{ width: 200, height: 150, mode: 'dominant', dithering: false, mergeThreshold: 30 }, '1995bcdf44d123dd4155280b34d6d8f7c7220e5410a48ff04268c85f3f260e03'],
}

for (const [name, [params, expected]] of Object.entries(cases)) {
  test(`经典算法输出不变：${name}`, () => assert.equal(convert(params), expected))
}
