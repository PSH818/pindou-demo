/**
 * 对图纸网格的纯计算：计数、收紧色板、去背景、排除颜色。
 * 不依赖 React、store 和 DOM，全部返回新数组，不修改传入的数据。
 */
import { TRANSPARENT, type BeadColor } from '../types/index.ts'

export interface GridAndPalette {
  grid: Uint16Array
  paletteUsed: number[]
}

/** 每种色号用了多少粒。Map 的顺序是色号在图纸里第一次出现的顺序。 */
export function countByColorId(grid: Uint16Array, paletteUsed: number[]): Map<number, number> {
  const counts = new Map<number, number>()
  for (const index of grid) {
    if (index === TRANSPARENT) continue
    const id = paletteUsed[index]
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

/** 去掉色板里已经没有珠子在用的颜色，并把网格下标改到新色板上。 */
export function compactPalette(grid: Uint16Array, paletteUsed: number[]): GridAndPalette {
  const used = new Uint8Array(paletteUsed.length)
  for (const index of grid) if (index !== TRANSPARENT) used[index] = 1
  const remap = new Uint16Array(paletteUsed.length)
  const nextPalette: number[] = []
  paletteUsed.forEach((id, index) => {
    if (used[index]) { remap[index] = nextPalette.length; nextPalette.push(id) }
  })
  return { grid: grid.map(index => index === TRANSPARENT ? TRANSPARENT : remap[index]), paletteUsed: nextPalette }
}

/**
 * 去背景：把四条边上最多的那种颜色当作背景色，
 * 只清掉与边缘连通的背景色格子，被主体包住的同色区域保留。
 * 边缘全是透明时返回 null。
 */
export function removeEdgeBackground(grid: Uint16Array, width: number, height: number, paletteUsed: number[]): GridAndPalette | null {
  const edge: number[] = []
  for (let x = 0; x < width; x++) edge.push(x, (height - 1) * width + x)
  for (let y = 1; y < height - 1; y++) edge.push(y * width, y * width + width - 1)

  const edgeCounts = new Map<number, number>()
  for (const cell of edge) {
    const index = grid[cell]
    if (index !== TRANSPARENT) edgeCounts.set(index, (edgeCounts.get(index) ?? 0) + 1)
  }
  let background = -1, most = 0
  // 并列时取下标最小的，结果与格子的遍历顺序无关
  for (const [index, count] of [...edgeCounts].sort((a, b) => a[0] - b[0])) {
    if (count > most) { most = count; background = index }
  }
  if (background === -1) return null

  const next = grid.slice()
  const visited = new Uint8Array(grid.length)
  const stack: number[] = []
  const seed = (cell: number) => {
    if (next[cell] === background && !visited[cell]) { visited[cell] = 1; stack.push(cell) }
  }
  edge.forEach(seed)
  while (stack.length) {
    const cell = stack.pop()!
    next[cell] = TRANSPARENT
    const x = cell % width, y = (cell - x) / width
    if (x > 0) seed(cell - 1)
    if (x < width - 1) seed(cell + 1)
    if (y > 0) seed(cell - width)
    if (y < height - 1) seed(cell + width)
  }
  return compactPalette(next, paletteUsed)
}

/**
 * 排除一种颜色：把它的珠子全部换成图纸里剩下的、Lab 距离最近的颜色。
 * 图纸里没有这种颜色，或没有别的颜色可换时返回 null。
 */
export function excludeColor(
  grid: Uint16Array,
  paletteUsed: number[],
  excludedColorId: number,
  colors: BeadColor[],
): (GridAndPalette & { excluded: BeadColor }) | null {
  const byId = new Map(colors.map(color => [color.id, color]))
  const from = paletteUsed.indexOf(excludedColorId)
  const excluded = byId.get(excludedColorId)
  if (from === -1 || !excluded) return null

  let to = -1, nearest = Infinity
  paletteUsed.forEach((id, index) => {
    const candidate = index === from ? undefined : byId.get(id)
    if (!candidate) return
    const distance = (excluded.lab[0] - candidate.lab[0]) ** 2 + (excluded.lab[1] - candidate.lab[1]) ** 2 + (excluded.lab[2] - candidate.lab[2]) ** 2
    if (distance < nearest) { nearest = distance; to = index }
  })
  if (to === -1) return null

  const replaced = grid.map(index => index === from ? to : index)
  return { ...compactPalette(replaced, paletteUsed), excluded }
}
