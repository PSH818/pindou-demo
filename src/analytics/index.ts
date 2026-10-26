import type { EventName, EventPayloadMap } from './events'

declare global {
  interface Window {
    umami?: {
      track(event: string, props?: Record<string, unknown>): void
    }
  }
}

/**
 * 上报一个埋点事件。
 * - 生产环境：调用 window.umami.track（Umami script 未注入时静默跳过）
 * - 开发环境：仅 console.debug，不上报，避免污染统计数据
 */
export function track<E extends EventName>(
  event: E,
  props?: EventPayloadMap[E],
): void {
  if (import.meta.env.DEV) {
    console.debug('[analytics]', event, props ?? {})
    return
  }
  window.umami?.track(event, props as Record<string, unknown>)
}

export { EVENTS } from './events'
export type { EventName, EventPayloadMap } from './events'
