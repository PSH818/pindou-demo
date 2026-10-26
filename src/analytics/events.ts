export const EVENTS = {
  // P0 — 核心转换漏斗
  UPLOAD_IMAGE:       'upload_image',
  CONVERT_START:      'convert_start',
  CONVERT_COMPLETE:   'convert_complete',
  CONVERT_FAIL:       'convert_fail',
  EXPORT_START:       'export_start',
  EXPORT_COMPLETE:    'export_complete',

  // P1 — 编辑器功能使用
  TOOL_USE:           'tool_use',
  UNDO:               'undo',
  REDO:               'redo',
  GUIDELINE_TOGGLE:   'guideline_toggle',
  GUIDELINE_COLOR:    'guideline_color',

  // P2 — 质量监控
  BG_REMOVE_START:    'bg_remove_start',
  BG_REMOVE_COMPLETE: 'bg_remove_complete',
  BG_REMOVE_FAIL:     'bg_remove_fail',
} as const

export type EventName = typeof EVENTS[keyof typeof EVENTS]

/** 每个事件对应的载荷类型。无载荷的事件用空对象。 */
export interface EventPayloadMap {
  upload_image:       { file_size_kb: number; mime_type: string }
  convert_start:      { grid_size: number; brand: string; color_count: number }
  convert_complete:   { duration_ms: number; pixel_count: number }
  convert_fail:       { error_type: string }
  export_start:       { format: 'image' | 'pdf' }
  export_complete:    { format: 'image' | 'pdf'; with_guideline: boolean }
  tool_use:           { tool: 'brush' | 'eraser' | 'fill' | 'eyedropper' }
  undo:               Record<string, never>
  redo:               Record<string, never>
  guideline_toggle:   { enabled: boolean }
  guideline_color:    { color: string }
  bg_remove_start:    Record<string, never>
  bg_remove_complete: { duration_ms: number }
  bg_remove_fail:     { error_type: string }
}
