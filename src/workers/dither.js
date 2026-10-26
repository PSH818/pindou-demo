/**
 * Floyd-Steinberg 误差扩散抖动
 *
 * 只在已选定的 paletteBeadColors 范围内寻找最近色，
 * 不会向 paletteUsed 增加新颜色，保持颜色数上限不变。
 *
 * @param {Uint16Array} grid            当前图纸（paletteUsed 下标），原地修改
 * @param {Uint8ClampedArray} pixels    缩放后原始像素（RGBA）
 * @param {number} width
 * @param {number} height
 * @param {{rgb:[number,number,number], lab:[number,number,number]}[]} paletteBeadColors
 *   只包含本图纸实际用到的颜色（paletteUsed 顺序），下标即为 grid 中存储的值
 */

import { rgb2lab, ciede2000 } from './colorMatch.js'

const TRANSPARENT = 0xFFFF

function floydSteinberg(grid, pixels, width, height, paletteBeadColors) {
  // 误差缓冲：每格 [er, eg, eb]，累积邻格传来的误差
  const errors = new Float32Array(width * height * 3)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (grid[i] === TRANSPARENT) continue

      const pi = i * 4
      // 原始像素 + 累积误差，clamp 到 [0, 255]
      const r = Math.min(255, Math.max(0, pixels[pi]     + errors[i * 3    ]))
      const g = Math.min(255, Math.max(0, pixels[pi + 1] + errors[i * 3 + 1]))
      const b = Math.min(255, Math.max(0, pixels[pi + 2] + errors[i * 3 + 2]))

      // 在 paletteBeadColors 中找 CIEDE2000 最近色
      const tLab = rgb2lab(r, g, b)
      let minDist = Infinity
      let bestIdx = 0
      for (let j = 0; j < paletteBeadColors.length; j++) {
        const dist = ciede2000(tLab, paletteBeadColors[j].lab)
        if (dist < minDist) { minDist = dist; bestIdx = j }
      }
      grid[i] = bestIdx

      // 量化误差（RGB 空间）
      const chosenRgb = paletteBeadColors[bestIdx].rgb
      const er = r - chosenRgb[0]
      const eg = g - chosenRgb[1]
      const eb = b - chosenRgb[2]

      // 向右和下方扩散误差（Floyd-Steinberg 权重）
      const spread = (nx, ny, factor) => {
        if (nx < 0 || nx >= width || ny >= height) return
        const ni = ny * width + nx
        errors[ni * 3    ] += er * factor
        errors[ni * 3 + 1] += eg * factor
        errors[ni * 3 + 2] += eb * factor
      }
      spread(x + 1, y,     7 / 16)
      spread(x - 1, y + 1, 3 / 16)
      spread(x,     y + 1, 5 / 16)
      spread(x + 1, y + 1, 1 / 16)
    }
  }
}

export { floydSteinberg }
