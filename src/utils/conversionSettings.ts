import type { ConversionAlgorithm, ConvertParams } from '../types/index.ts'

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
