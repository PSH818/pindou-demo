/**
 * Worker 入口 — 图像转换完整流程（复刻 liangdabiao/perler-beads-ai 算法）
 *
 * 流水线：
 *   1. 构建 5-bit RGB→拼豆ID 颜色查找表（RGB 欧氏距离）
 *   2. 每格取主色（dominant）或均值（average） → 查表映射为珠子色
 *   3. 全局频率优先颜色合并（RGB 欧氏距离，用户可调阈值）
 *   4. 背景去除 → 四边连通漫水填充标记为透明
 *   5. 收紧 palette
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

// ─── 3×3 均值预模糊 ─────────────────────────────────────────────
// 平滑 JPEG 边缘过渡区，防止单像素噪声主导某个格子的 dominant-bucket。

function blurSource(src, w, h) {
  var dst = new Uint8ClampedArray(src.length)
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var r = 0, g = 0, b = 0, a = 0, cnt = 0
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var nx = x + dx, ny = y + dy
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
          var p = (ny * w + nx) << 2
          r += src[p]; g += src[p + 1]; b += src[p + 2]; a += src[p + 3]
          cnt++
        }
      }
      var d = (y * w + x) << 2
      dst[d] = r / cnt | 0; dst[d + 1] = g / cnt | 0
      dst[d + 2] = b / cnt | 0; dst[d + 3] = a / cnt | 0
    }
  }
  return dst
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

// ─── 众数下采样（保留，抖动模式仍可能调用）────────────────────────

function buildGridByMode(srcIndexed, srcW, srcH, dstW, dstH, paletteSize) {
  var grid   = new Uint16Array(dstW * dstH)
  var xScale = srcW / dstW
  var yScale = srcH / dstH
  var counts = new Uint32Array(paletteSize)

  for (var dy = 0; dy < dstH; dy++) {
    for (var dx = 0; dx < dstW; dx++) {
      var x0 = Math.floor(dx * xScale)
      var x1 = Math.min(Math.ceil((dx + 1) * xScale), srcW)
      var y0 = Math.floor(dy * yScale)
      var y1 = Math.min(Math.ceil((dy + 1) * yScale), srcH)

      for (var k = 0; k < paletteSize; k++) counts[k] = 0
      var opaqueCount = 0

      for (var sy = y0; sy < y1; sy++) {
        for (var sx = x0; sx < x1; sx++) {
          var val = srcIndexed[sy * srcW + sx]
          if (val === TRANSPARENT) continue
          opaqueCount++
          counts[val]++
        }
      }

      var ci = dy * dstW + dx
      if (opaqueCount < (x1 - x0) * (y1 - y0) * 0.5) {
        grid[ci] = TRANSPARENT
        continue
      }

      var bestIdx = 0, bestCnt = 0
      for (var m = 0; m < paletteSize; m++) {
        if (counts[m] > bestCnt) { bestCnt = counts[m]; bestIdx = m }
      }
      grid[ci] = bestIdx
    }
  }
  return grid
}

// ─── 相似色区域合并（BFS，LAB 欧氏距离）─────────────────────────────
// 对每个未访问格，DFS 扩展到与当前格颜色 LAB 欧氏距离 ≤ distSqThresh 的 4 邻格，
// 形成"相似色区域"，整个区域统一设置为出现次数最多的颜色。
// 解决量化产生的相邻近似色杂斑（同色域内的色号噪点）。

function mergeSimilarRegions(grid, paletteUsed, palette, distSqThresh, width, height) {
  var n = grid.length

  var beadById = {}
  for (var j = 0; j < palette.length; j++) beadById[palette[j].id] = palette[j]

  var labByIdx = new Array(paletteUsed.length)
  for (var i = 0; i < paletteUsed.length; i++) {
    var b = beadById[paletteUsed[i]]
    labByIdx[i] = b ? b.lab : [0, 0, 0]
  }

  var visited = new Uint8Array(n)

  for (var start = 0; start < n; start++) {
    if (grid[start] === TRANSPARENT || visited[start]) continue

    var region   = []
    var colorCnt = {}
    var stack    = [start]
    visited[start] = 1

    while (stack.length > 0) {
      var cur  = stack.pop()
      var cIdx = grid[cur]
      region.push(cur)
      colorCnt[cIdx] = (colorCnt[cIdx] || 0) + 1

      var cx   = cur % width
      var cy   = (cur - cx) / width
      var cLab = labByIdx[cIdx]

      if (cx > 0) {
        var nb = cur - 1
        if (!visited[nb] && grid[nb] !== TRANSPARENT) {
          var nLab = labByIdx[grid[nb]]
          var dL = cLab[0] - nLab[0], da = cLab[1] - nLab[1], db = cLab[2] - nLab[2]
          if (dL * dL + da * da + db * db <= distSqThresh) { visited[nb] = 1; stack.push(nb) }
        }
      }
      if (cx < width - 1) {
        var nb = cur + 1
        if (!visited[nb] && grid[nb] !== TRANSPARENT) {
          var nLab = labByIdx[grid[nb]]
          var dL = cLab[0] - nLab[0], da = cLab[1] - nLab[1], db = cLab[2] - nLab[2]
          if (dL * dL + da * da + db * db <= distSqThresh) { visited[nb] = 1; stack.push(nb) }
        }
      }
      if (cy > 0) {
        var nb = cur - width
        if (!visited[nb] && grid[nb] !== TRANSPARENT) {
          var nLab = labByIdx[grid[nb]]
          var dL = cLab[0] - nLab[0], da = cLab[1] - nLab[1], db = cLab[2] - nLab[2]
          if (dL * dL + da * da + db * db <= distSqThresh) { visited[nb] = 1; stack.push(nb) }
        }
      }
      if (cy < height - 1) {
        var nb = cur + width
        if (!visited[nb] && grid[nb] !== TRANSPARENT) {
          var nLab = labByIdx[grid[nb]]
          var dL = cLab[0] - nLab[0], da = cLab[1] - nLab[1], db = cLab[2] - nLab[2]
          if (dL * dL + da * da + db * db <= distSqThresh) { visited[nb] = 1; stack.push(nb) }
        }
      }
    }

    var bestIdx = grid[start], bestCnt = 0
    for (var k in colorCnt) {
      if (colorCnt[k] > bestCnt) { bestCnt = colorCnt[k]; bestIdx = parseInt(k) }
    }

    for (var ri = 0; ri < region.length; ri++) {
      grid[region[ri]] = bestIdx
    }
  }
}

// ─── BFS 小连通区域合并 ────────────────────────────────────────────
// 1. DFS 找所有 4 连通同色区域
// 2. 面积 < threshold 的区域：统计边界上接触次数最多的邻接色，替换整个区域
//    → 空间意义上的"孤立小团"才被合并，嘴巴内部/腮红等有意义的小区域不受影响

function mergeRareColors(grid, paletteUsed, palette, threshold, width, height) {
  var n      = grid.length
  var compOf = new Int32Array(n).fill(-1)  // 每格所属连通区域 ID，-1 = 未访问
  var compCells = []                        // compCells[c] = 区域 c 的格子下标列表

  // ── DFS：找所有同色 4-连通区域 ──────────────────────────────────
  for (var start = 0; start < n; start++) {
    if (grid[start] === TRANSPARENT || compOf[start] !== -1) continue

    var colorIdx = grid[start]
    var cells    = []
    var stack    = [start]
    var cId      = compCells.length
    compOf[start] = cId

    while (stack.length > 0) {
      var cur = stack.pop()
      cells.push(cur)
      var cx = cur % width
      var cy = (cur - cx) / width

      // 4 邻格：左右上下
      if (cx > 0) {
        var nb = cur - 1
        if (compOf[nb] === -1 && grid[nb] === colorIdx) { compOf[nb] = cId; stack.push(nb) }
      }
      if (cx < width - 1) {
        var nb = cur + 1
        if (compOf[nb] === -1 && grid[nb] === colorIdx) { compOf[nb] = cId; stack.push(nb) }
      }
      if (cy > 0) {
        var nb = cur - width
        if (compOf[nb] === -1 && grid[nb] === colorIdx) { compOf[nb] = cId; stack.push(nb) }
      }
      if (cy < height - 1) {
        var nb = cur + width
        if (compOf[nb] === -1 && grid[nb] === colorIdx) { compOf[nb] = cId; stack.push(nb) }
      }
    }

    compCells.push(cells)
  }

  // ── 替换小区域 ──────────────────────────────────────────────────
  for (var c = 0; c < compCells.length; c++) {
    var cells = compCells[c]
    if (cells.length >= threshold) continue  // 面积够大，保留

    var selfColor = grid[cells[0]]
    var adjCounts = {}

    for (var ci = 0; ci < cells.length; ci++) {
      var cell = cells[ci]
      var cx   = cell % width
      var cy   = (cell - cx) / width

      if (cx > 0) {
        var nb = cell - 1
        var nc = grid[nb]
        if (nc !== TRANSPARENT && nc !== selfColor) adjCounts[nc] = (adjCounts[nc] || 0) + 1
      }
      if (cx < width - 1) {
        var nb = cell + 1
        var nc = grid[nb]
        if (nc !== TRANSPARENT && nc !== selfColor) adjCounts[nc] = (adjCounts[nc] || 0) + 1
      }
      if (cy > 0) {
        var nb = cell - width
        var nc = grid[nb]
        if (nc !== TRANSPARENT && nc !== selfColor) adjCounts[nc] = (adjCounts[nc] || 0) + 1
      }
      if (cy < height - 1) {
        var nb = cell + width
        var nc = grid[nb]
        if (nc !== TRANSPARENT && nc !== selfColor) adjCounts[nc] = (adjCounts[nc] || 0) + 1
      }
    }

    // 找接触次数最多的邻接色
    var bestColor = -1, bestCount = 0
    for (var key in adjCounts) {
      var cnt = adjCounts[key]
      if (cnt > bestCount) { bestCount = cnt; bestColor = parseInt(key) }
    }

    // 替换整个区域
    if (bestColor !== -1) {
      for (var ci = 0; ci < cells.length; ci++) grid[cells[ci]] = bestColor
    }
  }
}

// ─── 孤立像素清理 ──────────────────────────────────────────────────

function cleanTransitions(grid, width, height) {
  var len = grid.length
  var src = new Uint16Array(len)

  for (var pass = 0; pass < 3; pass++) {
    for (var j = 0; j < len; j++) src[j] = grid[j]

    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var i   = y * width + x
        var cur = src[i]
        if (cur === TRANSPARENT) continue

        var counts = {}
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (dy === 0 && dx === 0) continue
            var nx = x + dx, ny = y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            var nc = src[ny * width + nx]
            if (nc === TRANSPARENT) continue
            counts[nc] = (counts[nc] || 0) + 1
          }
        }

        var selfCount = counts[cur] || 0
        if (selfCount >= 1) continue  // 至少 1 个同色邻居就保留，保住细线和曲线

        var best = cur, bestCnt = 0
        for (var c in counts) {
          if (counts[c] > bestCnt) { bestCnt = counts[c]; best = parseInt(c) }
        }
        if (bestCnt >= 2) grid[i] = best
      }
    }
  }
}

// ─── 背景去除 ──────────────────────────────────────────────────────
// 统计上下左右四条边上最高频的颜色 → 判定为背景色。
// 从四条边上所有该颜色的格子出发，四连通漫水填充，全部标记为 TRANSPARENT。
// 只去除外围背景，图案内部的同色区域不受影响。

function removeBackground(grid, width, height) {
  // 统计边缘颜色频率
  var borderCounts = {}
  for (var x = 0; x < width; x++) {
    var t = grid[x]
    var b = grid[(height - 1) * width + x]
    if (t !== TRANSPARENT) borderCounts[t] = (borderCounts[t] || 0) + 1
    if (b !== TRANSPARENT) borderCounts[b] = (borderCounts[b] || 0) + 1
  }
  for (var y = 1; y < height - 1; y++) {
    var l = grid[y * width]
    var r = grid[y * width + width - 1]
    if (l !== TRANSPARENT) borderCounts[l] = (borderCounts[l] || 0) + 1
    if (r !== TRANSPARENT) borderCounts[r] = (borderCounts[r] || 0) + 1
  }

  var bgColor = -1, maxCount = 0
  for (var c in borderCounts) {
    if (borderCounts[c] > maxCount) {
      maxCount = borderCounts[c]
      bgColor = parseInt(c)
    }
  }

  // 边缘格子全都是 TRANSPARENT，无需去除
  if (bgColor === -1) return

  // 四连通漫水填充（迭代栈，避免递归栈溢出）
  var visited = new Uint8Array(width * height)
  var stack   = []

  function seedIfBg(idx) {
    if (grid[idx] === bgColor && !visited[idx]) {
      visited[idx] = 1
      stack.push(idx)
    }
  }

  for (var x = 0; x < width; x++) {
    seedIfBg(x)
    seedIfBg((height - 1) * width + x)
  }
  for (var y = 1; y < height - 1; y++) {
    seedIfBg(y * width)
    seedIfBg(y * width + width - 1)
  }

  while (stack.length > 0) {
    var idx = stack.pop()
    grid[idx] = TRANSPARENT
    var cx = idx % width
    var cy = (idx - cx) / width
    if (cx > 0)          seedIfBg(idx - 1)
    if (cx < width - 1)  seedIfBg(idx + 1)
    if (cy > 0)          seedIfBg(idx - width)
    if (cy < height - 1) seedIfBg(idx + width)
  }
}

// ─── 悬空孤格清理 ──────────────────────────────────────────────────
// 去除四方向均无非透明邻格的孤立格子。
// 背景去除后原来与背景相连的边角格可能变成孤格，这一步消除它们。

function removeSingletons(grid, width, height) {
  // 八连通：对角邻格也算，避免删掉描边斜角格
  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      var i = y * width + x
      if (grid[i] === TRANSPARENT) continue
      var hasNeighbor = false
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (dy === 0 && dx === 0) continue
          var nx = x + dx, ny = y + dy
          if (nx >= 0 && nx < width && ny >= 0 && ny < height &&
              grid[ny * width + nx] !== TRANSPARENT) {
            hasNeighbor = true
          }
        }
      }
      if (!hasNeighbor) grid[i] = TRANSPARENT
    }
  }
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
