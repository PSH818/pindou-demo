export const MIN_GRID_SIDE = 1
export const MAX_GRID_SIDE = 200
export const MAX_GRID_CELLS = 40_000
export const MAX_SAVED_PATTERNS = 50

export const MAX_EXPORT_CANVAS_SIDE = 8_192
export const MAX_EXPORT_CANVAS_PIXELS = 32_000_000

export function isPatternCapacityReached(count: number): boolean {
  return count >= MAX_SAVED_PATTERNS
}

export function validateGridDimensions(width: number, height: number): string | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return '图纸宽高必须是整数'
  if (width < MIN_GRID_SIDE || height < MIN_GRID_SIDE) return '图纸宽高必须大于 0'
  if (width > MAX_GRID_SIDE || height > MAX_GRID_SIDE) {
    return `图纸单边不能超过 ${MAX_GRID_SIDE} 格`
  }
  if (width * height > MAX_GRID_CELLS) return `图纸总格数不能超过 ${MAX_GRID_CELLS} 格`
  return null
}

export function assertGridDimensions(width: number, height: number): void {
  const error = validateGridDimensions(width, height)
  if (error) throw new Error(error)
}

export function clampEditorGridHeight(width: number, aspectRatio: number): number {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return width
  return Math.min(MAX_GRID_SIDE, Math.max(10, Math.round(width / aspectRatio)))
}

export function assertSafeExportCanvas(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('导出画布尺寸无效')
  }
  if (width > MAX_EXPORT_CANVAS_SIDE || height > MAX_EXPORT_CANVAS_SIDE ||
      width * height > MAX_EXPORT_CANVAS_PIXELS) {
    throw new Error('导出图片尺寸过大，请使用标准清晰度或减小图纸尺寸')
  }
}
