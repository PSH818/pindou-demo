/**
 * 图像缩放
 *
 * resizeBox：面积平均（box filter）降采样。
 * 每个输出像素取其在源图中对应矩形区域内所有源像素的加权平均，
 * 是照片→像素格降采样的正确做法——输出颜色是格子区域的真实代表色，
 * 不会产生双三次插值那种"只采样4×4个点"造成的虚假混色。
 *
 * resizeBicubic：保留供上采样或轻微缩放场景使用。
 */

/**
 * 面积平均降采样（推荐用于照片→拼豆格子）
 * @param {Uint8ClampedArray} src 源图像 RGBA 数据
 * @param {number} srcW
 * @param {number} srcH
 * @param {number} dstW
 * @param {number} dstH
 * @returns {Uint8ClampedArray}
 */
function resizeBox(src, srcW, srcH, dstW, dstH) {
  var dst = new Uint8ClampedArray(dstW * dstH * 4)
  var xScale = srcW / dstW
  var yScale = srcH / dstH

  for (var dy = 0; dy < dstH; dy++) {
    for (var dx = 0; dx < dstW; dx++) {
      var x0 = dx * xScale
      var x1 = x0 + xScale
      var y0 = dy * yScale
      var y1 = y0 + yScale

      var ix0 = Math.floor(x0)
      var ix1 = Math.min(Math.ceil(x1), srcW)
      var iy0 = Math.floor(y0)
      var iy1 = Math.min(Math.ceil(y1), srcH)

      var r = 0, g = 0, b = 0, a = 0, wTotal = 0

      for (var sy = iy0; sy < iy1; sy++) {
        // 该行在输出格子 y 方向上的覆盖比例（处理边缘部分像素）
        var wy = Math.min(sy + 1, y1) - Math.max(sy, y0)
        for (var sx = ix0; sx < ix1; sx++) {
          var wx = Math.min(sx + 1, x1) - Math.max(sx, x0)
          var w  = wx * wy
          var pi = (sy * srcW + sx) * 4
          r += src[pi    ] * w
          g += src[pi + 1] * w
          b += src[pi + 2] * w
          a += src[pi + 3] * w
          wTotal += w
        }
      }

      var di = (dy * dstW + dx) * 4
      if (wTotal > 0) {
        dst[di    ] = Math.round(r / wTotal)
        dst[di + 1] = Math.round(g / wTotal)
        dst[di + 2] = Math.round(b / wTotal)
        dst[di + 3] = Math.round(a / wTotal)
      }
    }
  }
  return dst
}

/**
 * 双三次插值（保留，适合上采样 / 轻微缩放）
 */
function cubic(t) {
  var a = -0.5
  var at = Math.abs(t)
  if (at <= 1) return (a + 2) * at * at * at - (a + 3) * at * at + 1
  if (at < 2)  return a * at * at * at - 5 * a * at * at + 8 * a * at - 4 * a
  return 0
}

function resizeBicubic(src, srcW, srcH, dstW, dstH) {
  var dst    = new Uint8ClampedArray(dstW * dstH * 4)
  var xRatio = srcW / dstW
  var yRatio = srcH / dstH

  for (var dstY = 0; dstY < dstH; dstY++) {
    for (var dstX = 0; dstX < dstW; dstX++) {
      var srcX = dstX * xRatio
      var srcY = dstY * yRatio
      var x0   = Math.floor(srcX)
      var y0   = Math.floor(srcY)

      var r = 0, g = 0, b = 0, a = 0, total = 0

      for (var m = -1; m <= 2; m++) {
        for (var n = -1; n <= 2; n++) {
          var px  = Math.min(Math.max(x0 + n, 0), srcW - 1)
          var py  = Math.min(Math.max(y0 + m, 0), srcH - 1)
          var w   = cubic(srcX - (x0 + n)) * cubic(srcY - (y0 + m))
          var idx = (py * srcW + px) * 4
          r += src[idx    ] * w
          g += src[idx + 1] * w
          b += src[idx + 2] * w
          a += src[idx + 3] * w
          total += w
        }
      }

      var dstIdx = (dstY * dstW + dstX) * 4
      dst[dstIdx    ] = Math.min(Math.max(Math.round(r / total), 0), 255)
      dst[dstIdx + 1] = Math.min(Math.max(Math.round(g / total), 0), 255)
      dst[dstIdx + 2] = Math.min(Math.max(Math.round(b / total), 0), 255)
      dst[dstIdx + 3] = Math.min(Math.max(Math.round(a / total), 0), 255)
    }
  }
  return dst
}

module.exports = { resizeBox, resizeBicubic }
