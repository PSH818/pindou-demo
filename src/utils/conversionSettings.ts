import type { ConversionAlgorithm, ConvertParams, Pattern } from '../types/index.ts'

export const ALGORITHM_LABELS: Record<ConversionAlgorithm, string> = {
  legacy: '经典模式',
  'perceptual-v1': '保真模式（测试版）',
  'cartoon-v1': '保真模式 · 轮廓增强',
}

// Internal pipeline revisions, not upstream project release numbers.
const ALGORITHM_VERSIONS = { legacy: 'legacy-frozen-1', 'perceptual-v1': 'perceptual-1', 'cartoon-v1': 'cartoon-1' } as const
const PREFERENCE_KEY = 'pindou.conversionAlgorithm.v1'
const CONTOUR_KEY = 'pindou.contourEnhance.v1'

export const algorithmFamily = (algorithm?: ConversionAlgorithm): ConversionAlgorithm =>
  algorithm === 'cartoon-v1' || algorithm === 'perceptual-v1' ? 'perceptual-v1' : 'legacy'

export function resolveConversionAlgorithm(algorithm: ConversionAlgorithm, mode: ConvertParams['mode'], contour: boolean): ConversionAlgorithm {
  return algorithmFamily(algorithm) === 'legacy' ? 'legacy' : mode === 'dominant' && contour ? 'cartoon-v1' : 'perceptual-v1'
}

export function readContourPreference(): boolean {
  try {
    const saved = localStorage.getItem(CONTOUR_KEY)
    return saved === null ? localStorage.getItem(PREFERENCE_KEY) === 'cartoon-v1' : saved === 'true'
  } catch { return false }
}

export function rememberContourPreference(enabled: boolean): void {
  try { localStorage.setItem(CONTOUR_KEY, String(enabled)) } catch { /* optional preference */ }
}

export function readPreferredAlgorithm(): ConversionAlgorithm {
  try { return algorithmFamily(localStorage.getItem(PREFERENCE_KEY) as ConversionAlgorithm) }
  catch { return 'legacy' }
}

/** Only call after successfully saving an adopted/generated result. */
export function rememberAlgorithm(algorithm: ConversionAlgorithm): void {
  try { localStorage.setItem(PREFERENCE_KEY, algorithm) }
  catch { /* Storage restrictions must not prevent conversion. */ }
}

export function conversionMetadata(params: ConvertParams, algorithm = params.algorithm ?? 'legacy') {
  return {
    conversionAlgorithm: algorithm,
    conversionVersion: ALGORITHM_VERSIONS[algorithm],
    conversionParams: { ...params, algorithm,
      ...(params.subjectFocus !== undefined ? { subjectFocus: algorithm !== 'legacy' && params.subjectFocus } : {}),
      contourEnhance: algorithm === 'cartoon-v1' && params.mode === 'dominant',
    },
  }
}

/** 参数表单里的选择。algorithm 只区分经典 / 保真两族，轮廓增强是单独的开关。 */
export interface ConversionForm {
  algorithm: ConversionAlgorithm
  mode: ConvertParams['mode']
  contourEnhance: boolean
  subjectFocus: boolean
  width: number
  height: number
  brandId: ConvertParams['brandId']
  dithering: boolean
  mergeThreshold: number
}

/** 表单 → Worker 参数。经典模式不支持轮廓增强和主体优先，轮廓增强只在卡通主色下生效。 */
export function buildConvertParams(form: ConversionForm): ConvertParams {
  const faithful = algorithmFamily(form.algorithm) !== 'legacy'
  return {
    algorithm: resolveConversionAlgorithm(form.algorithm, form.mode, form.contourEnhance),
    contourEnhance: faithful && form.mode === 'dominant' && form.contourEnhance,
    subjectFocus: faithful && form.subjectFocus,
    width: form.width,
    height: form.height,
    brandId: form.brandId,
    dithering: form.dithering,
    edgeEnhance: true,
    mergeThreshold: form.mergeThreshold,
    mode: form.mode,
  }
}

/** 转换结果 → 图纸对象。重新转换已有图纸时传入它的 id / name / createdAt 以保留身份。 */
export function patternFromConversion(
  result: { grid: Uint16Array; paletteUsed: number[] },
  params: ConvertParams,
  identity: { id: string; name: string; createdAt?: number },
  thumbnail: string,
  algorithm: ConversionAlgorithm = params.algorithm ?? 'legacy',
): Pattern {
  const now = Date.now()
  return {
    ...conversionMetadata(params, algorithm),
    id: identity.id,
    name: identity.name,
    width: params.width,
    height: params.height,
    brandId: params.brandId,
    paletteUsed: [...result.paletteUsed],
    grid: result.grid.slice(),
    thumbnail,
    createdAt: identity.createdAt ?? now,
    updatedAt: now,
  }
}
