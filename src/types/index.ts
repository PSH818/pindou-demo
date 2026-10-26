// 全局类型定义
// 修改此文件后，Worker 内使用的对应类型需同步手动更新 workers/ 中的 JSDoc 注释

// ─── 品牌与色板 ──────────────────────────────────────────────

export const BRAND_IDS = ['mard', 'coco', 'manman', 'panpan', 'mixiaowo', 'artkal_c'] as const
export type BrandId = (typeof BRAND_IDS)[number]

export function isBrandId(value: unknown): value is BrandId {
  return typeof value === 'string' && (BRAND_IDS as readonly string[]).includes(value)
}

// 5 个通用品牌的色号系统（来自 colorSystemMapping.json）
export const COLOR_SYSTEMS = ['MARD', 'COCO', '漫漫', '盼盼', '咪小窝'] as const
export type ColorSystem = (typeof COLOR_SYSTEMS)[number]

export interface BeadColor {
  id: number
  code: string
  name: string
  rgb: [number, number, number]
  lab: [number, number, number]          // 预计算，避免运行时转换
  brandCodes?: Partial<Record<ColorSystem, string>>  // 多品牌色号
}

export interface BeadBrand {
  id: BrandId
  name: string
  beadSizeMm: number
  colorSystem: ColorSystem | null
  colors: BeadColor[]
}

// ─── 图纸 ────────────────────────────────────────────────────

export interface Pattern {
  conversionAlgorithm?: ConversionAlgorithm
  conversionVersion?: string
  /** Original conversion settings; later manual edits do not rewrite this snapshot. */
  conversionParams?: ConvertParams
  id: string
  name: string
  width: number
  height: number
  brandId: BrandId
  paletteUsed: number[]           // 用到的 BeadColor.id 列表
  grid: Uint16Array               // 扁平，长度 = width * height
                                  // 值为 paletteUsed 的下标；0xFFFF = 透明
  thumbnail: string               // base64 PNG 64×64
  createdAt: number
  updatedAt: number
}

// 用于列表展示，不含 grid 大数据
export type PatternMeta = Omit<Pattern, 'grid'>

// ─── 转换参数 ────────────────────────────────────────────────

export type ConversionAlgorithm = 'legacy' | 'perceptual-v1' | 'cartoon-v1'

export interface ConvertParams {
  algorithm?: ConversionAlgorithm     // 缺省始终使用现有算法
  subjectFocus?: boolean              // 保真系列：可选自动主体取景，不拉伸
  contourEnhance?: boolean            // 保真＋卡通：独立轮廓增强开关
  width: number
  height: number
  brandId: BrandId
  dithering: boolean
  edgeEnhance: boolean
  mergeThreshold: number              // 颜色合并阈值（RGB 欧氏距离），0-100，默认 30
  mode: 'dominant' | 'average'        // 卡通主色 / 写实均值
}

// ─── 编辑器状态 ──────────────────────────────────────────────

export type EditTool = 'brush' | 'fill' | 'eyedropper' | 'eraser'

export interface EditorState {
  tool: EditTool
  selectedColorIdx: number        // paletteUsed 中的下标
  scale: number                   // px/格，8~32
  offsetX: number
  offsetY: number
  highlightColorIdx: number | null
}

// ─── 用料清单 ────────────────────────────────────────────────

export interface MaterialItem {
  colorId: number
  code: string
  name: string
  rgb: [number, number, number]
  count: number                   // 粒数
}

// ─── Worker 消息协议 ─────────────────────────────────────────

export interface WorkerRequest {
  type: 'convert'
  imageData: ArrayBuffer          // ImageData.data 的 buffer（RGBA）
  imageWidth: number
  imageHeight: number
  params: ConvertParams
  palette: BeadColor[]            // 完整色板传入 Worker，内部不加载 JSON
}

export type WorkerResponseType = 'progress' | 'result' | 'error'

export interface WorkerResponse {
  type: WorkerResponseType
  progress?: number               // 0~100
  grid?: ArrayBuffer              // Uint16Array.buffer
  paletteUsed?: number[]
  error?: string
}

// ─── 导出参数 ────────────────────────────────────────────────

export interface ExportImageOptions {
  scale?: 16 | 32                 // 每格像素数，默认 16
  showGrid?: boolean              // 默认 true
  showNumbers?: boolean           // 默认 false（格子 ≥ 20px 时可启用）
  showLegend?: boolean            // 默认 true
}

export interface ExportPdfOptions {
  includeGrid: boolean
  includeMaterials: boolean
}

export const TRANSPARENT = 0xFFFF  // grid 中表示"不放珠"的特殊值
