/**
 * 从 colorSystemMapping.json 生成 mard.json（BeadColor[] 格式）
 * 用法：node scripts/gen_mard_palette.js
 */
const fs = require('fs')
const path = require('path')

const src = require('../src/data/colorSystemMapping.json')

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

// 与 src/workers/colorMatch.js 完全相同的 rgb2lab
function rgb2lab(r, g, b) {
  function toLinear(c) {
    c = c / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  const R = toLinear(r), G = toLinear(g), B = toLinear(b)
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750
  const Z = R * 0.0193339 + G * 0.1191920 + B * 0.9503041
  function f(t) {
    return t > 0.008856 ? Math.cbrt(t) : 7.787037 * t + 16 / 116
  }
  const L = 116 * f(Y / 1.00000) - 16
  const a = 500 * (f(X / 0.95047) - f(Y / 1.00000))
  const bv = 200 * (f(Y / 1.00000) - f(Z / 1.08883))
  return [
    Math.round(L * 1000) / 1000,
    Math.round(a * 1000) / 1000,
    Math.round(bv * 1000) / 1000,
  ]
}

const result = Object.entries(src).map(([hex, brands], id) => {
  const [r, g, b] = hexToRgb(hex)
  const lab = rgb2lab(r, g, b)
  return {
    id,
    code: brands['MARD'],
    name: brands['MARD'],   // 暂用色号作为名称，后续可手动补充中文名
    rgb: [r, g, b],
    lab,
    brandCodes: brands,
  }
})

const outPath = path.join(__dirname, '../src/data/mard.json')
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8')
console.log(`生成 ${result.length} 色 → ${outPath}`)
