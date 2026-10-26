/**
 * CIEDE2000 颜色匹配
 * 将 Octree 量化后的颜色中心映射到品牌珠子色板
 */

/**
 * RGB 转 CIELAB
 * @param {number} r 0~255
 * @param {number} g 0~255
 * @param {number} b 0~255
 * @returns {[number, number, number]} LAB
 */
function rgb2lab(r, g, b) {
  let rn = r / 255
  let gn = g / 255
  let bn = b / 255

  rn = rn > 0.04045 ? Math.pow((rn + 0.055) / 1.055, 2.4) : rn / 12.92
  gn = gn > 0.04045 ? Math.pow((gn + 0.055) / 1.055, 2.4) : gn / 12.92
  bn = bn > 0.04045 ? Math.pow((bn + 0.055) / 1.055, 2.4) : bn / 12.92

  const x = (rn * 0.4124564 + gn * 0.3575761 + bn * 0.1804375) / 0.95047
  const y = (rn * 0.2126729 + gn * 0.7151522 + bn * 0.0721750) / 1.00000
  const z = (rn * 0.0193339 + gn * 0.1191920 + bn * 0.9503041) / 1.08883

  const f = v => v > 0.008856 ? Math.pow(v, 1 / 3) : 7.787 * v + 16 / 116

  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

/**
 * CIEDE2000 色差计算
 * @param {[number, number, number]} lab1
 * @param {[number, number, number]} lab2
 * @returns {number} 色差值，越小越接近
 */
function ciede2000(lab1, lab2) {
  const [L1, a1, b1] = lab1
  const [L2, a2, b2] = lab2

  const C1 = Math.sqrt(a1 * a1 + b1 * b1)
  const C2 = Math.sqrt(a2 * a2 + b2 * b2)
  const Cab = (C1 + C2) / 2
  const Cab7 = Math.pow(Cab, 7)
  const G = 0.5 * (1 - Math.sqrt(Cab7 / (Cab7 + 6103515625)))

  const a1p = a1 * (1 + G)
  const a2p = a2 * (1 + G)
  const C1p = Math.sqrt(a1p * a1p + b1 * b1)
  const C2p = Math.sqrt(a2p * a2p + b2 * b2)

  const h1p = Math.atan2(b1, a1p) * (180 / Math.PI) + (b1 < 0 || (b1 === 0 && a1p < 0) ? 360 : 0)
  const h2p = Math.atan2(b2, a2p) * (180 / Math.PI) + (b2 < 0 || (b2 === 0 && a2p < 0) ? 360 : 0)

  const dLp = L2 - L1
  const dCp = C2p - C1p

  let dhp
  if (C1p * C2p === 0) {
    dhp = 0
  } else if (Math.abs(h2p - h1p) <= 180) {
    dhp = h2p - h1p
  } else if (h2p - h1p > 180) {
    dhp = h2p - h1p - 360
  } else {
    dhp = h2p - h1p + 360
  }

  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * (Math.PI / 180))
  const Lpm = (L1 + L2) / 2
  const Cpm = (C1p + C2p) / 2

  let Hpm
  if (C1p * C2p === 0) {
    Hpm = h1p + h2p
  } else if (Math.abs(h1p - h2p) <= 180) {
    Hpm = (h1p + h2p) / 2
  } else if (h1p + h2p < 360) {
    Hpm = (h1p + h2p + 360) / 2
  } else {
    Hpm = (h1p + h2p - 360) / 2
  }

  const T = 1
    - 0.17 * Math.cos((Hpm - 30) * (Math.PI / 180))
    + 0.24 * Math.cos(2 * Hpm * (Math.PI / 180))
    + 0.32 * Math.cos((3 * Hpm + 6) * (Math.PI / 180))
    - 0.20 * Math.cos((4 * Hpm - 63) * (Math.PI / 180))

  const SL = 1 + 0.015 * Math.pow(Lpm - 50, 2) / Math.sqrt(20 + Math.pow(Lpm - 50, 2))
  const SC = 1 + 0.045 * Cpm
  const SH = 1 + 0.015 * Cpm * T

  const Cpm7 = Math.pow(Cpm, 7)
  const RC = 2 * Math.sqrt(Cpm7 / (Cpm7 + 6103515625))
  const dTheta = 30 * Math.exp(-Math.pow((Hpm - 275) / 25, 2))
  const RT = -Math.sin(2 * dTheta * (Math.PI / 180)) * RC

  return Math.sqrt(
    Math.pow(dLp / SL, 2) +
    Math.pow(dCp / SC, 2) +
    Math.pow(dHp / SH, 2) +
    RT * (dCp / SC) * (dHp / SH)
  )
}

/**
 * 将量化颜色中心映射到品牌珠子色板
 * @param {{r,g,b}[]} colorCenters Octree 输出的颜色中心
 * @param {{id,rgb,lab}[]} palette 品牌色板（含预计算 LAB）
 * @returns {{ mapping: number[], paletteUsed: number[] }}
 *   mapping[i] = colorCenters[i] 对应的 paletteUsed 下标
 *   paletteUsed = 实际用到的 palette.id 列表
 */
function mapToBeadPalette(colorCenters, palette) {
  const usedIds = new Set()
  const centerToBeadId = []

  for (const center of colorCenters) {
    const centerLab = rgb2lab(center.r, center.g, center.b)
    let minDist = Infinity
    let bestId = 0

    for (const bead of palette) {
      const dist = ciede2000(centerLab, bead.lab)
      if (dist < minDist) {
        minDist = dist
        bestId = bead.id
      }
    }

    centerToBeadId.push(bestId)
    usedIds.add(bestId)
  }

  const paletteUsed = Array.from(usedIds)
  const idToIdx = new Map(paletteUsed.map((id, i) => [id, i]))
  const mapping = centerToBeadId.map(id => idToIdx.get(id))

  return { mapping, paletteUsed }
}

export { mapToBeadPalette, rgb2lab, ciede2000 }
