import test from 'node:test'
import assert from 'node:assert/strict'
import { locateChartGrid } from './gridLocate.js'

function chart({ cols = 30, rows = 24, cw = 16, ch = 16, line = 1,
  left = 23, top = 37, right = 31, bottom = 130, major = 5, invert = false,
  mixed = true, transparent = false } = {}) {
  const w = Math.round(cols * cw), h = Math.round(rows * ch)
  const width = left + w + right, height = top + h + bottom
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let rgb = [250, 247, 241], alpha = 255
    const rx = x - left, ry = y - top
    if (rx >= 0 && rx < w && ry >= 0 && ry < h) {
      const col = Math.floor(rx / cw), row = Math.floor(ry / ch)
      rgb = invert ? [30, 30, 30] : [249, 242, 180]
      if (mixed && (col * 17 + row * 11) % 7 < 3) rgb = [45, 43, 48]
      const vx = rx - Math.round(col * cw) < line || rx >= w - line
      const hy = ry - Math.round(row * ch) < line || ry >= h - line
      if (transparent) alpha = 0
      if (vx || hy) {
        rgb = major && ((vx && col % major === 0) || (hy && row % major === 0))
          ? [244, 60, 75] : invert ? [240, 240, 240] : [190, 190, 190]
        alpha = 255
      }
    }
    data.set([...rgb, alpha], (y * width + x) * 4)
  }
  return { data, width, height, crop: { x: left, y: top, w, h }, cols, rows }
}

test('完整图纸：外围留白、底部图例区域，深浅底色与每五/十格红线', () => {
  for (const options of [{}, { major: 10 }, { invert: true }, { transparent: true },
    { left: 91, top: 121, right: 170, bottom: 57 }, { cols: 60, rows: 60 }]) {
    const f = chart(options), result = locateChartGrid(f.data, f.width, f.height)
    assert.ok(result, JSON.stringify(options))
    assert.deepEqual([result.cols, result.rows], [f.cols, f.rows], JSON.stringify({ options, result }))
    for (const k of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(result.crop[k] - f.crop[k]) <= 2, `${k}: ${JSON.stringify(result)}`)
  }
})

test('矩形格距、非整数缩放、不同线宽，不能识别成半格或五倍格', () => {
  for (const options of [{ cw: 12, ch: 24 }, { cw: 20.5, ch: 17.5 },
    ...[1, 2, 3, 5, 8].map(line => ({ cw: 24, ch: 24, line }))]) {
    const f = chart(options), result = locateChartGrid(f.data, f.width, f.height)
    assert.ok(result, JSON.stringify(options))
    assert.deepEqual([result.cols, result.rows], [f.cols, f.rows], JSON.stringify({ options, result }))
  }
})

test('仅网格的输入仍能覆盖完整范围', () => {
  const f = chart({ left: 0, top: 0, right: 0, bottom: 0, mixed: false, line: 3 })
  const result = locateChartGrid(f.data, f.width, f.height)
  assert.deepEqual(result, { crop: f.crop, cols: f.cols, rows: f.rows })
})

test('大图的采样间距恰好等于格距时，不全部采到横向粗线', () => {
  const f = chart({ cols: 20, rows: 192, cw: 20, ch: 20, line: 8,
    left: 0, top: 0, right: 0, bottom: 0, mixed: false, major: 0 })
  const result = locateChartGrid(f.data, f.width, f.height)
  assert.deepEqual(result, { crop: f.crop, cols: f.cols, rows: f.rows })
})

test('空白、随机噪声和透明隐藏 RGB 不得臆造网格', () => {
  const width = 320, height = 240
  const data = new Uint8ClampedArray(width * height * 4)
  assert.equal(locateChartGrid(data, width, height), null)
  let seed = 1
  for (let i = 0; i < data.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; data[i] = seed >>> 24 }
  assert.equal(locateChartGrid(data, width, height), null)
  for (let i = 3; i < data.length; i += 4) data[i] = 0
  assert.equal(locateChartGrid(data, width, height), null)
})
