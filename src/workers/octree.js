/**
 * Octree 颜色量化算法
 * 将图片颜色压缩到指定数量的主色（maxColors）
 */

const MAX_DEPTH = 8

class OctreeNode {
  constructor(depth) {
    this.depth = depth
    this.pixelCount = 0
    this.rSum = 0
    this.gSum = 0
    this.bSum = 0
    this.children = new Array(8).fill(null)
    this.isLeaf = depth >= MAX_DEPTH
    this.childCount = 0
  }

  addColor(r, g, b, depth, tree) {
    if (this.isLeaf) {
      this.pixelCount++
      this.rSum += r
      this.gSum += g
      this.bSum += b
      return
    }

    const idx = OctreeNode.colorIndex(r, g, b, depth)
    if (!this.children[idx]) {
      this.children[idx] = new OctreeNode(depth + 1)
      this.childCount++
      if (depth < MAX_DEPTH - 1) {
        tree.reducible[depth].push(this.children[idx])
      } else {
        tree.leafCount++
      }
    }
    this.children[idx].addColor(r, g, b, depth + 1, tree)
  }

  merge() {
    for (const child of this.children) {
      if (!child) continue
      this.pixelCount += child.pixelCount
      this.rSum += child.rSum
      this.gSum += child.gSum
      this.bSum += child.bSum
    }
    this.children.fill(null)
    this.isLeaf = true
    this.childCount = 0
  }

  collectLeaves(result) {
    if (this.isLeaf) {
      result.push({
        r: Math.round(this.rSum / this.pixelCount),
        g: Math.round(this.gSum / this.pixelCount),
        b: Math.round(this.bSum / this.pixelCount),
        pixelCount: this.pixelCount,
      })
      return
    }
    for (const child of this.children) {
      if (child) child.collectLeaves(result)
    }
  }

  static colorIndex(r, g, b, depth) {
    const shift = 7 - depth
    return ((r >> shift) & 1) << 2 | ((g >> shift) & 1) << 1 | ((b >> shift) & 1)
  }
}

class OctreeQuantizer {
  constructor(maxColors) {
    this.maxColors = maxColors
    this.root = new OctreeNode(0)
    this.leafCount = 0
    this.reducible = Array.from({ length: MAX_DEPTH }, () => [])
    this._palette = null
  }

  addColor(r, g, b) {
    this.root.addColor(r, g, b, 0, this)
    while (this.leafCount > this.maxColors) {
      this._reduceTree()
    }
    this._palette = null  // 使缓存失效
  }

  _reduceTree() {
    for (let i = MAX_DEPTH - 1; i >= 0; i--) {
      if (this.reducible[i].length > 0) {
        const node = this.reducible[i].pop()
        const childCount = node.childCount  // 必须在 merge() 前读取，merge 会把 childCount 清零
        node.merge()
        this.leafCount -= childCount - 1
        return
      }
    }
  }

  getPalette() {
    if (!this._palette) {
      this._palette = []
      this.root.collectLeaves(this._palette)
    }
    return this._palette
  }

  getColorIndex(r, g, b) {
    const palette = this.getPalette()
    let minDist = Infinity
    let bestIdx = 0
    for (let i = 0; i < palette.length; i++) {
      const dr = r - palette[i].r
      const dg = g - palette[i].g
      const db = b - palette[i].b
      const dist = dr * dr + dg * dg + db * db
      if (dist < minDist) {
        minDist = dist
        bestIdx = i
      }
    }
    return bestIdx
  }
}

module.exports = { OctreeQuantizer }
