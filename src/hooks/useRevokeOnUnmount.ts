import { useEffect, useRef } from 'react'
import { revokeObjectUrl } from '../utils/webUtils'

/**
 * StrictMode 安全的 blob URL 卸载回收。
 *
 * React 18 StrictMode 在开发环境会执行「挂载 → 模拟卸载 → 再挂载」，
 * 直接在 effect cleanup 里 revokeObjectUrl 会把二次挂载后仍需使用的
 * blob URL 提前回收（图片 broken、转换报「图片加载失败」）。
 * 这里把回收延迟到宏任务：模拟卸载后紧跟的重新挂载会取消它，
 * 只有真实卸载才会执行。
 *
 * @param getUrls   返回待回收的 URL 列表（在卸载后的宏任务里调用，取最新值）
 * @param onCleanup 可选，真实卸载时的其它清理（如清空 store 引用）
 */
export function useRevokeOnUnmount(
  getUrls: () => (string | null | undefined)[],
  onCleanup?: () => void,
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  // 故意不写依赖数组：每次渲染的 setup 都会取消上一次 cleanup 安排的回收，
  // 只有组件真正卸载后，最后一个宏任务才会执行。
  useEffect(() => {
    clearTimeout(timerRef.current)
    return () => {
      timerRef.current = setTimeout(() => {
        for (const url of getUrls()) revokeObjectUrl(url)
        onCleanup?.()
      }, 0)
    }
  })
}
