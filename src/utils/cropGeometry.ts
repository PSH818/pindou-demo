export type DragHandle = 'tl' | 'tr' | 'bl' | 'br' | 'body' | 'new'

export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function nearHandle(px: number, py: number, hx: number, hy: number, radius = 28): boolean {
  return Math.abs(px - hx) < radius && Math.abs(py - hy) < radius
}

export function inBox(px: number, py: number, box: CropRect): boolean {
  return px > box.x && px < box.x + box.w && py > box.y && py < box.y + box.h
}

export function computeNewCrop(
  handle: DragHandle,
  tx: number,
  ty: number,
  startX: number,
  startY: number,
  startCrop: CropRect,
  maxX: number,
  maxY: number,
  minSize = 24,
): CropRect {
  const sc = startCrop
  if (handle === 'tl') {
    const nx = clamp(tx, 0, sc.x + sc.w - minSize)
    const ny = clamp(ty, 0, sc.y + sc.h - minSize)
    return { x: nx, y: ny, w: sc.x + sc.w - nx, h: sc.y + sc.h - ny }
  }
  if (handle === 'tr') {
    const ny = clamp(ty, 0, sc.y + sc.h - minSize)
    return { x: sc.x, y: ny, w: Math.max(minSize, clamp(tx, sc.x + minSize, maxX) - sc.x), h: sc.y + sc.h - ny }
  }
  if (handle === 'bl') {
    const nx = clamp(tx, 0, sc.x + sc.w - minSize)
    return { x: nx, y: sc.y, w: sc.x + sc.w - nx, h: Math.max(minSize, clamp(ty, sc.y + minSize, maxY) - sc.y) }
  }
  if (handle === 'br') {
    return {
      x: sc.x,
      y: sc.y,
      w: Math.max(minSize, clamp(tx, sc.x + minSize, maxX) - sc.x),
      h: Math.max(minSize, clamp(ty, sc.y + minSize, maxY) - sc.y),
    }
  }
  if (handle === 'body') {
    return {
      x: clamp(sc.x + (tx - startX), 0, maxX - sc.w),
      y: clamp(sc.y + (ty - startY), 0, maxY - sc.h),
      w: sc.w,
      h: sc.h,
    }
  }
  const x1 = clamp(Math.min(startX, tx), 0, maxX)
  const y1 = clamp(Math.min(startY, ty), 0, maxY)
  const x2 = clamp(Math.max(startX, tx), 0, maxX)
  const y2 = clamp(Math.max(startY, ty), 0, maxY)
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}
