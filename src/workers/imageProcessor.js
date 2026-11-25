/**
 * Worker 入口 — 图像转换完整流程（复刻 liangdabiao/perler-beads-ai 算法）
 *
 * 流水线：
 *   1. 构建 5-bit RGB→拼豆ID 颜色查找表（RGB 欧氏距离）
 *   2. 每格取主色（dominant）或均值（average） → 查表映射为珠子色
 *   3. 全局频率优先颜色合并（RGB 欧氏距离，用户可调阈值）
 *   4. 收紧 palette
 *   5. Floyd-Steinberg 抖动（可选）
 *
 * 输出由 imageProcessor.test.js 的结果锁保护：可以整理代码，不能改变转换结果。
 */

import { floydSteinberg } from './dither.js'

const TRANSPARENT = 0xFFFF

// 5-bit LUT：32^3 = 32768 桶
// 白色(31,31,31) 和米黄(30,27,23) 在不同桶，不会混淆
const LUT_BITS = 5
const LUT_SIZE = 1 << LUT_BITS  // 32

self.onmessage = function (e) {
  const msg = e.data
  if (msg.type !== 'convert') return
  try {
    run(msg)
  } catch (err) {
    self.postMessage({ type: 'error', error: err.message || String(err) })
  }
}

function run(msg) {
  var imageData      = msg.imageData
  var imageWidth     = msg.imageWidth
  var imageHeight    = msg.imageHeight
  var params         = msg.params
  var palette        = msg.palette
  var targetW        = params.width
  var targetH        = params.height
  var dithering      = params.dithering
  var mode           = params.mode || 'dominant'
  var mergeThreshold = params.mergeThreshold !== undefined ? params.mergeThreshold : 30

  var srcPixels = new Uint8ClampedArray(imageData)

  // ── Step 1: 构建颜色查找表（RGB 欧氏距离）────────────────────────
  progress(5)
  var lut = buildLUT(palette)

  // ── Step 2+3: 每格取代表色 → 查表映射为珠子色 ────────────────────
  // dominant（卡通主色）：统计格内各 5-bit RGB Bucket 频率，取最高频 Bucket
  // average（写实均值）：对格内所有像素求 RGB 均值
  progress(20)
  var result
  if (mode === 'average') {
    result = buildGridByAverage(srcPixels, imageWidth, imageHeight, targetW, targetH, lut)
  } else {
    result = buildGridByDominantBucket(srcPixels, imageWidth, imageHeight, targetW, targetH, lut)
  }
  var grid        = result.grid
  var paletteUsed = result.paletteUsed

  // ── Step 4: 全局频率优先颜色合并（RGB 欧氏距离）──────────────────
  // 按使用频率降序排列颜色，低频色被 RGB 距离 < mergeThreshold 的高频色吸收。
  progress(60)
  mergeByFrequency(grid, paletteUsed, palette, mergeThreshold)

  // ── Step 6: 收紧 palette ──────────────────────────────────────────
  progress(90)
  var finalPaletteUsed = compactUsed(grid, paletteUsed)

  // ── Step 7: Floyd-Steinberg 抖动（可选）──────────────────────────
  if (dithering) {
    progress(95)
    var scaled = resizeBox(srcPixels, imageWidth, imageHeight, targetW, targetH)
    var colorById = {}
    for (var ci = 0; ci < palette.length; ci++) colorById[palette[ci].id] = palette[ci]
    var paletteBeadColors = finalPaletteUsed.map(function (id) { return colorById[id] })
    floydSteinberg(grid, scaled, targetW, targetH, paletteBeadColors)
  }

  progress(100)
  self.postMessage({
    type: 'result',
    grid: grid.buffer,
    paletteUsed: finalPaletteUsed,
  }, [grid.buffer])
}

// ─── 全局频率优先颜色合并（RGB 欧氏距离）─────────────────────────────
// 复刻自 liangdabiao/perler-beads-ai，距离度量使用 RGB 欧氏距离。
// 1. 统计每个调色板色的使用格数
// 2. 按频率降序排列
// 3. 对每对颜色，若 RGB 欧氏距离 < rgbThreshold，将低频色整体替换为高频色

function mergeByFrequency(grid, paletteUsed, palette, rgbThreshold) {
  var n = paletteUsed.length
  if (n < 2) return

  var beadById = {}
  for (var j = 0; j < palette.length; j++) beadById[palette[j].id] = palette[j]

  var counts = new Int32Array(n)
  for (var i = 0; i < grid.length; i++) {
    if (grid[i] !== TRANSPARENT) counts[grid[i]]++
  }

  var sorted = []
  for (var i = 0; i < n; i++) sorted.push(i)
  sorted.sort(function (a, b) { return counts[b] - counts[a] })

  var active    = new Uint8Array(n).fill(1)
  var replaceBy = new Int32Array(n).fill(-1)

  for (var i = 0; i < sorted.length; i++) {
    var hiIdx = sorted[i]
    if (!active[hiIdx]) continue

    var hiBead = beadById[paletteUsed[hiIdx]]
    if (!hiBead) continue
    var hr = hiBead.rgb[0], hg = hiBead.rgb[1], hb = hiBead.rgb[2]

    for (var j = i + 1; j < sorted.length; j++) {
      var loIdx = sorted[j]
      if (!active[loIdx]) continue

      var loBead = beadById[paletteUsed[loIdx]]
      if (!loBead) continue
      var dr = hr - loBead.rgb[0]
      var dg = hg - loBead.rgb[1]
      var db = hb - loBead.rgb[2]
      var dist = Math.sqrt(dr * dr + dg * dg + db * db)  // RGB 欧氏距离
      if (dist < rgbThreshold) {
        active[loIdx]    = 0
        replaceBy[loIdx] = hiIdx
      }
    }
  }

  for (var i = 0; i < grid.length; i++) {
    var v = grid[i]
    if (v !== TRANSPARENT && replaceBy[v] !== -1) grid[i] = replaceBy[v]
  }
}

// ─── 构建颜色查找表（RGB 欧氏距离）─────────────────────────────────

function buildLUT(palette) {
  var lut  = new Uint16Array(LUT_SIZE * LUT_SIZE * LUT_SIZE)
  var step = LUT_SIZE - 1  // 31

  for (var ri = 0; ri < LUT_SIZE; ri++) {
    for (var gi = 0; gi < LUT_SIZE; gi++) {
      for (var bi = 0; bi < LUT_SIZE; bi++) {
        var r = Math.round(ri * 255 / step)
        var g = Math.round(gi * 255 / step)
        var b = Math.round(bi * 255 / step)

        var minDist = Infinity
        var bestId  = 0
        for (var j = 0; j < palette.length; j++) {
          var pr   = palette[j].rgb[0]
          var pg   = palette[j].rgb[1]
          var pb   = palette[j].rgb[2]
          var dr   = r - pr, dg = g - pg, db = b - pb
          var dist = dr * dr + dg * dg + db * db  // RGB 欧氏距离平方
          if (dist < minDist) { minDist = dist; bestId = palette[j].id }
        }
        lut[ri * LUT_SIZE * LUT_SIZE + gi * LUT_SIZE + bi] = bestId
      }
    }
  }
  return lut
}

// ─── 主导 RGB Bucket 下采样 ──────────────────────────────────────
// 每格在原始 RGB 空间统计各 5-bit Bucket 出现次数，取最高频 Bucket，
// 再一次映射为珠子色 ID + 建立 paletteUsed。
// 返回 { grid, paletteUsed }。

function buildGridByDominantBucket(srcPixels, srcW, srcH, dstW, dstH, lut) {
  var grid        = new Uint16Array(dstW * dstH)
  var idToIdx     = {}
  var paletteUsed = []
  var xScale      = srcW / dstW
  var yScale      = srcH / dstH
  var shift       = 8 - LUT_BITS   // 3
  var stride1     = LUT_SIZE * LUT_SIZE

  for (var dy = 0; dy < dstH; dy++) {
    for (var dx = 0; dx < dstW; dx++) {
      var x0       = Math.floor(dx * xScale)
      var x1       = Math.min(Math.ceil((dx + 1) * xScale), srcW)
      var y0       = Math.floor(dy * yScale)
      var y1       = Math.min(Math.ceil((dy + 1) * yScale), srcH)
      var cellArea = (x1 - x0) * (y1 - y0)
      var opaqueCount = 0
      var buckets     = {}

      for (var sy = y0; sy < y1; sy++) {
        for (var sx = x0; sx < x1; sx++) {
          var pi = (sy * srcW + sx) * 4
          if (srcPixels[pi + 3] < 128) continue
          opaqueCount++
          // 15-bit bucket key: (r>>3)<<10 | (g>>3)<<5 | (b>>3)
          var bk = ((srcPixels[pi]     >> shift) << 10)
                 | ((srcPixels[pi + 1] >> shift) <<  5)
                 |  (srcPixels[pi + 2] >> shift)
          buckets[bk] = (buckets[bk] || 0) + 1
        }
      }

      var ci = dy * dstW + dx
      if (opaqueCount < cellArea * 0.5) {
        grid[ci] = TRANSPARENT
        continue
      }

      var bestBk = 0, bestCnt = 0
      for (var bk2 in buckets) {
        if (buckets[bk2] > bestCnt) { bestCnt = buckets[bk2]; bestBk = parseInt(bk2) }
      }

      // 解码 bucket key → LUT 下标 → beadId
      var ri  = (bestBk >> 10) & 0x1F
      var gi  = (bestBk >>  5) & 0x1F
      var bi2 =  bestBk        & 0x1F
      var beadId = lut[ri * stride1 + gi * LUT_SIZE + bi2]

      if (idToIdx[beadId] === undefined) {
        idToIdx[beadId] = paletteUsed.length
        paletteUsed.push(beadId)
      }
      grid[ci] = idToIdx[beadId]
    }
  }

  return { grid: grid, paletteUsed: paletteUsed }
}

// ─── 均值下采样（写实均值模式）────────────────────────────────────────
// 对每格内所有不透明像素求 RGB 均值，再通过 LUT 映射为珠子色。
// 适合渐变色、写实照片；卡通线稿建议使用 dominant 模式。

function buildGridByAverage(srcPixels, srcW, srcH, dstW, dstH, lut) {
  var grid        = new Uint16Array(dstW * dstH)
  var idToIdx     = {}
  var paletteUsed = []
  var xScale      = srcW / dstW
  var yScale      = srcH / dstH
  var stride1     = LUT_SIZE * LUT_SIZE
  var shift       = 8 - LUT_BITS

  for (var dy = 0; dy < dstH; dy++) {
    for (var dx = 0; dx < dstW; dx++) {
      var x0       = Math.floor(dx * xScale)
      var x1       = Math.min(Math.ceil((dx + 1) * xScale), srcW)
      var y0       = Math.floor(dy * yScale)
      var y1       = Math.min(Math.ceil((dy + 1) * yScale), srcH)
      var cellArea = (x1 - x0) * (y1 - y0)
      var rSum = 0, gSum = 0, bSum = 0, opaqueCount = 0

      for (var sy = y0; sy < y1; sy++) {
        for (var sx = x0; sx < x1; sx++) {
          var pi = (sy * srcW + sx) * 4
          if (srcPixels[pi + 3] < 128) continue
          opaqueCount++
          rSum += srcPixels[pi]
          gSum += srcPixels[pi + 1]
          bSum += srcPixels[pi + 2]
        }
      }

      var ci = dy * dstW + dx
      if (opaqueCount < cellArea * 0.5) {
        grid[ci] = TRANSPARENT
        continue
      }

      var r = rSum / opaqueCount | 0
      var g = gSum / opaqueCount | 0
      var b = bSum / opaqueCount | 0

      var ri2     = r >> shift
      var gi2     = g >> shift
      var bi2     = b >> shift
      var beadId  = lut[ri2 * stride1 + gi2 * LUT_SIZE + bi2]

      if (idToIdx[beadId] === undefined) {
        idToIdx[beadId] = paletteUsed.length
        paletteUsed.push(beadId)
      }
      grid[ci] = idToIdx[beadId]
    }
  }

  return { grid: grid, paletteUsed: paletteUsed }
}

// ─── 收紧 palette ──────────────────────────────────────────────────

function compactUsed(grid, paletteUsed) {
  var used = new Uint8Array(paletteUsed.length)
  for (var i = 0; i < grid.length; i++) {
    if (grid[i] !== TRANSPARENT) used[grid[i]] = 1
  }

  var oldToNew   = new Int16Array(paletteUsed.length).fill(-1)
  var newPalette = []
  for (var j = 0; j < paletteUsed.length; j++) {
    if (used[j]) { oldToNew[j] = newPalette.length; newPalette.push(paletteUsed[j]) }
  }

  for (var gi = 0; gi < grid.length; gi++) {
    if (grid[gi] !== TRANSPARENT) grid[gi] = oldToNew[grid[gi]]
  }
  return newPalette
}

// ─── 面积平均下采样（仅抖动模式使用）────────────────────────────────

function resizeBox(src, srcW, srcH, dstW, dstH) {
  var dst    = new Uint8ClampedArray(dstW * dstH * 4)
  var xScale = srcW / dstW
  var yScale = srcH / dstH

  for (var dy = 0; dy < dstH; dy++) {
    for (var dx = 0; dx < dstW; dx++) {
      var x0 = dx * xScale,  x1 = x0 + xScale
      var y0 = dy * yScale,  y1 = y0 + yScale
      var ix0 = Math.floor(x0), ix1 = Math.min(Math.ceil(x1), srcW)
      var iy0 = Math.floor(y0), iy1 = Math.min(Math.ceil(y1), srcH)
      var r = 0, g = 0, b = 0, a = 0, wTotal = 0

      for (var sy = iy0; sy < iy1; sy++) {
        var wy = Math.min(sy + 1, y1) - Math.max(sy, y0)
        for (var sx = ix0; sx < ix1; sx++) {
          var wx = Math.min(sx + 1, x1) - Math.max(sx, x0)
          var w  = wx * wy
          var p  = (sy * srcW + sx) * 4
          r += src[p] * w;  g += src[p + 1] * w
          b += src[p + 2] * w;  a += src[p + 3] * w
          wTotal += w
        }
      }

      var di = (dy * dstW + dx) * 4
      if (wTotal > 0) {
        dst[di]     = Math.round(r / wTotal)
        dst[di + 1] = Math.round(g / wTotal)
        dst[di + 2] = Math.round(b / wTotal)
        dst[di + 3] = Math.round(a / wTotal)
      }
    }
  }
  return dst
}

function progress(pct) {
  self.postMessage({ type: 'progress', progress: pct })
}
