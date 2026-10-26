/**
 * 颜色空间工具函数
 * 此文件同时被主线程和 Worker 使用，不能包含任何浏览器/小程序 API 依赖
 */

export type RGB = [number, number, number]
export type LAB = [number, number, number]

export function rgb2lab(r: number, g: number, b: number): LAB {
  let rn = r / 255
  let gn = g / 255
  let bn = b / 255

  rn = rn > 0.04045 ? Math.pow((rn + 0.055) / 1.055, 2.4) : rn / 12.92
  gn = gn > 0.04045 ? Math.pow((gn + 0.055) / 1.055, 2.4) : gn / 12.92
  bn = bn > 0.04045 ? Math.pow((bn + 0.055) / 1.055, 2.4) : bn / 12.92

  const x = (rn * 0.4124564 + gn * 0.3575761 + bn * 0.1804375) / 0.95047
  const y = (rn * 0.2126729 + gn * 0.7151522 + bn * 0.0721750) / 1.00000
  const z = (rn * 0.0193339 + gn * 0.1191920 + bn * 0.9503041) / 1.08883

  const f = (v: number) => v > 0.008856 ? Math.pow(v, 1 / 3) : 7.787 * v + 16 / 116

  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

/** 将 RGB 格式化为 CSS 颜色字符串 */
export function rgb2css(rgb: RGB): string {
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
}

/** 将 RGB 转为十六进制字符串，用于导出 */
export function rgb2hex(rgb: RGB): string {
  return '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('')
}
