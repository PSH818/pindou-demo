/**
 * 图纸转换流程 Hook
 * 职责：加载图片缓冲区 → 启动 Worker → 接收结果 → 更新 store + storage
 */

import { useCallback } from 'react'
import { nanoid } from 'nanoid/non-secure'
import { usePatternStore } from '../store/patternStore'
import { loadBrand } from '../utils/palette'
import { savePattern } from '../utils/storage'
import { conversionMetadata, rememberAlgorithm } from '../utils/conversionSettings'
import { loadImageToBuffer, generateThumbnail } from '../utils/imageLoader'
import { TRANSPARENT, type ConvertParams, type Pattern, type WorkerRequest, type WorkerResponse } from '../types'

export class ConversionCancelledError extends Error {
  constructor() {
    super('转换已取消')
    this.name = 'ConversionCancelledError'
  }
}

interface ActiveTask {
  worker: Worker
  reject: (reason: Error) => void
}

let _activeTask: ActiveTask | null = null
let _conversionGeneration = 0

function terminateActive(reason: Error): void {
  const task = _activeTask
  if (!task) return
  _activeTask = null
  task.worker.terminate()
  task.reject(reason)
}

export function usePattern() {
  const setPattern = usePatternStore(s => s.setPattern)

  const convert = useCallback(async (
    imagePath: string,
    params: ConvertParams,
    onProgress?: (p: number) => void,
    basePattern?: Pattern | null,
    persist?: (pattern: Pattern) => Promise<void>,
  ): Promise<Pattern> => {

    const generation = ++_conversionGeneration
    terminateActive(new ConversionCancelledError())

    onProgress?.(2)
    const { data, width: imgW, height: imgH } = await loadImageToBuffer(imagePath, 400)
    if (generation !== _conversionGeneration) throw new ConversionCancelledError()

    onProgress?.(5)
    const brand = await loadBrand(params.brandId)
    if (generation !== _conversionGeneration) throw new ConversionCancelledError()

    const worker = params.algorithm === 'cartoon-v1' ? new Worker(
      new URL('../workers/cartoonProcessor.js', import.meta.url), { type: 'module' }
    ) : params.algorithm === 'perceptual-v1' ? new Worker(
      new URL('../workers/faithfulProcessor.js', import.meta.url),
      { type: 'module' }
    ) : new Worker(
      new URL('../workers/imageProcessor.js', import.meta.url),
      { type: 'module' }
    )
    const request: WorkerRequest = {
      type: 'convert',
      imageData: data,
      imageWidth: imgW,
      imageHeight: imgH,
      params,
      palette: brand.colors,
    }

    return new Promise<Pattern>((resolve, reject) => {
      _activeTask = { worker, reject }

      const fail = (error: Error) => {
        if (_activeTask?.worker === worker) _activeTask = null
        worker.terminate()
        reject(error)
      }

      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (generation !== _conversionGeneration) return
        const res = e.data
        switch (res.type) {
          case 'progress':
            onProgress?.(5 + Math.round((res.progress ?? 0) * 0.95))
            break

          case 'result': {
            if (_activeTask?.worker === worker) _activeTask = null
            worker.terminate()
            if (!isValidWorkerResult(res, params.width, params.height)) {
              reject(new Error('Worker 返回数据异常'))
              return
            }
            const grid = new Uint16Array(res.grid)
            const paletteUsed = res.paletteUsed
            ;(async () => {
              const thumbnail = await generateThumbnail(
                grid, params.width, params.height, paletteUsed, brand.colors
              ).catch(() => '')
              if (generation !== _conversionGeneration) throw new ConversionCancelledError()
              const pattern: Pattern = {
                ...conversionMetadata(params),
                id: basePattern?.id ?? nanoid(8),
                name: basePattern?.name ?? '新图纸',
                width:  params.width,
                height: params.height,
                brandId: params.brandId,
                paletteUsed,
                grid,
                thumbnail,
                createdAt: basePattern?.createdAt ?? Date.now(),
                updatedAt: Date.now(),
              }
              await (persist ? persist(pattern) : savePattern(pattern, basePattern ?? null))
              if (generation !== _conversionGeneration) throw new ConversionCancelledError()
              rememberAlgorithm(params.algorithm ?? 'legacy')
              setPattern(pattern)
              resolve(pattern)
            })().catch(reject)
            break
          }

          case 'error':
            fail(new Error(res.error ?? '转换失败'))
            break
        }
      }

      worker.onerror = () => {
        fail(new Error('转换进程意外退出，请重试'))
      }

      worker.postMessage(request, [data])
    })
  }, [setPattern])

  const cancel = useCallback(() => {
    _conversionGeneration++
    terminateActive(new ConversionCancelledError())
  }, [])

  return { convert, cancel }
}

function isValidWorkerResult(
  response: WorkerResponse,
  width: number,
  height: number,
): response is WorkerResponse & { grid: ArrayBuffer; paletteUsed: number[] } {
  if (!(response.grid instanceof ArrayBuffer) || response.grid.byteLength !== width * height * 2) return false
  if (!Array.isArray(response.paletteUsed) ||
      response.paletteUsed.some(id => !Number.isInteger(id) || id < 0)) return false
  const grid = new Uint16Array(response.grid)
  for (const value of grid) {
    if (value !== TRANSPARENT && value >= response.paletteUsed.length) return false
  }
  return true
}
