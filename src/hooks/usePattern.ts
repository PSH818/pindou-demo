/**
 * 图纸转换流程 Hook
 * 职责：加载图片缓冲区 → 跑转换 → 生成图纸 → 存盘 → 更新 store
 * Worker 的创建、收发和结果校验在 utils/conversionRunner.ts。
 */

import { useCallback } from 'react'
import { nanoid } from 'nanoid/non-secure'
import { usePatternStore } from '../store/patternStore'
import { loadBrand } from '../utils/palette'
import { savePattern } from '../utils/storage'
import { patternFromConversion, rememberAlgorithm } from '../utils/conversionSettings'
import { runConversion } from '../utils/conversionRunner'
import { loadImageToBuffer, generateThumbnail } from '../utils/imageLoader'
import type { ConvertParams, Pattern } from '../types'

export class ConversionCancelledError extends Error {
  constructor() {
    super('转换已取消')
    this.name = 'ConversionCancelledError'
  }
}

// 同一时间只保留一次转换：新转换开始或用户取消时，中止上一次
let _active: AbortController | null = null

export function usePattern() {
  const setPattern = usePatternStore(s => s.setPattern)

  const convert = useCallback(async (
    imagePath: string,
    params: ConvertParams,
    onProgress?: (p: number) => void,
    basePattern?: Pattern | null,
    persist?: (pattern: Pattern) => Promise<void>,
  ): Promise<Pattern> => {
    _active?.abort()
    const controller = _active = new AbortController()
    const { signal } = controller
    // 每个异步步骤之后都要检查：期间可能已被取消或被更新的一次转换取代
    const ensureCurrent = () => { if (signal.aborted) throw new ConversionCancelledError() }

    try {
      onProgress?.(2)
      const image = await loadImageToBuffer(imagePath, 400)
      ensureCurrent()

      onProgress?.(5)
      const brand = await loadBrand(params.brandId)
      ensureCurrent()

      const result = await runConversion(image, params, brand.colors, {
        signal,
        onProgress: percent => onProgress?.(5 + Math.round(percent * 0.95)),
      })
      const thumbnail = await generateThumbnail(result.grid, params.width, params.height, result.paletteUsed, brand.colors).catch(() => '')
      ensureCurrent()

      const pattern = patternFromConversion(result, params, {
        id: basePattern?.id ?? nanoid(8),
        name: basePattern?.name ?? '新图纸',
        createdAt: basePattern?.createdAt,
      }, thumbnail)
      await (persist ? persist(pattern) : savePattern(pattern, basePattern ?? null))
      ensureCurrent()

      rememberAlgorithm(params.algorithm ?? 'legacy')
      setPattern(pattern)
      return pattern
    } catch (error) {
      if (signal.aborted) throw new ConversionCancelledError()
      throw error
    } finally {
      if (_active === controller) _active = null
    }
  }, [setPattern])

  const cancel = useCallback(() => {
    _active?.abort()
    _active = null
  }, [])

  return { convert, cancel }
}
