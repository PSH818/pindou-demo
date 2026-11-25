/**
 * 参数页的实时预览：参数一变就在 Worker 里重新转换，结果只留在内存里。
 * 用户点「用这张图纸」之前不写 store、不写 IndexedDB。
 */

import { useEffect, useRef, useState } from 'react'
import { loadBrand } from '../utils/palette'
import { loadImageToBuffer, type RawImageBuffer } from '../utils/imageLoader'
import { previewImage, previewStats, runPreview, type ConversionPreview } from '../utils/algorithmComparison'
import type { BeadColor, ConvertParams } from '../types'

export interface LivePreview {
  result: ConversionPreview
  colors: BeadColor[]
  /** 生成这张预览时用的参数，采用时必须用它而不是表单的当前值 */
  params: ConvertParams
  /** 每格 1 像素的图纸图片，显示时用 image-rendering: pixelated 放大 */
  image: string
  stats: { beads: number; colors: number }
}

export function useLivePreview(imagePath: string | null, params: ConvertParams | null, delayMs: number) {
  const [preview, setPreview] = useState<LivePreview | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 原图只读一次像素，之后每次转换拷贝一份给 Worker
  const source = useRef<{ path: string; image: Promise<RawImageBuffer> } | null>(null)

  // 参数对象每次渲染都是新的，用内容作为依赖
  const key = params ? JSON.stringify(params) : null

  useEffect(() => {
    if (!imagePath || !params) { setPending(false); return }
    const controller = new AbortController()
    const { signal } = controller
    setPending(true)
    setError(null)

    // 稍等一下再算：拖动滑块时只为停下来的那个值转换；过期的转换直接中止
    const timer = setTimeout(async () => {
      try {
        if (source.current?.path !== imagePath) source.current = { path: imagePath, image: loadImageToBuffer(imagePath, 400) }
        const [image, brand] = await Promise.all([source.current.image, loadBrand(params.brandId)])
        if (signal.aborted) return
        const result = await runPreview(image, params, brand.colors, params.algorithm ?? 'legacy', signal, () => {})
        if (signal.aborted) return
        const { beads, colors } = previewStats(result.grid, params.width, params.height)
        setPreview({
          result, colors: brand.colors, params,
          image: previewImage(result, params.width, params.height, brand.colors),
          stats: { beads, colors },
        })
        setPending(false)
      } catch (e) {
        if (signal.aborted) return
        setError(e instanceof Error ? e.message : '预览生成失败，请重试')
        setPending(false)
      }
    }, delayMs)

    return () => { clearTimeout(timer); controller.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- params 以 key（内容）为准
  }, [imagePath, key, delayMs])

  // 预览与当前参数一致时才允许采用
  const fresh = !!preview && !pending && !error && JSON.stringify(preview.params) === key
  return { preview, pending, error, fresh }
}
