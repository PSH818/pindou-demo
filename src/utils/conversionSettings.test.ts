// @ts-nocheck — Node test runner.
import test from 'node:test'
import assert from 'node:assert/strict'
import { conversionMetadata, readPreferredAlgorithm, rememberAlgorithm, readContourPreference, rememberContourPreference, resolveConversionAlgorithm, algorithmFamily } from './conversionSettings.ts'

test('conversion metadata snapshots parameters and records explicit algorithm revision', () => {
  const params = { width: 60, height: 48, brandId: 'mard', mode: 'dominant', dithering: false, edgeEnhance: true, mergeThreshold: 30 }
  const classic = conversionMetadata(params)
  const faithful = conversionMetadata(params, 'perceptual-v1')
  params.width = 90
  assert.equal(classic.conversionAlgorithm, 'legacy')
  assert.equal(classic.conversionVersion, 'legacy-frozen-1')
  assert.equal(faithful.conversionParams.algorithm, 'perceptual-v1')
  assert.equal(faithful.conversionParams.width, 60)
  assert.notEqual(classic.conversionVersion, faithful.conversionVersion)
})

test('两种 UI 算法、独立轮廓偏好和旧增强模式迁移', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map()
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    } })
    assert.equal(readContourPreference(), false)
    rememberAlgorithm('cartoon-v1')
    assert.equal(readPreferredAlgorithm(), 'perceptual-v1')
    assert.equal(readContourPreference(), true)
    rememberContourPreference(false)
    assert.equal(readContourPreference(), false, 'explicit switch overrides historical preference')
    assert.equal(algorithmFamily('cartoon-v1'), 'perceptual-v1')
    assert.equal(resolveConversionAlgorithm('legacy', 'dominant', true), 'legacy')
    assert.equal(resolveConversionAlgorithm('perceptual-v1', 'dominant', true), 'cartoon-v1')
    assert.equal(resolveConversionAlgorithm('perceptual-v1', 'dominant', false), 'perceptual-v1')
    assert.equal(resolveConversionAlgorithm('perceptual-v1', 'average', true), 'perceptual-v1')
    const params = { mode: 'dominant', subjectFocus: true, contourEnhance: true }
    assert.equal(conversionMetadata(params, 'legacy').conversionParams.subjectFocus, false)
    assert.equal(conversionMetadata(params, 'legacy').conversionParams.contourEnhance, false)
    assert.equal(conversionMetadata(params, 'perceptual-v1').conversionParams.subjectFocus, true)
    assert.equal(conversionMetadata(params, 'perceptual-v1').conversionParams.contourEnhance, false)
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete globalThis.localStorage
  }
})

test('preference defaults safely and remembers only explicit writes', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  let value = null
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: () => value, setItem: (_key, next) => { value = next },
    } })
    assert.equal(readPreferredAlgorithm(), 'legacy')
    rememberAlgorithm('perceptual-v1')
    assert.equal(readPreferredAlgorithm(), 'perceptual-v1')
    value = 'invalid'
    assert.equal(readPreferredAlgorithm(), 'legacy')
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('blocked') } })
    assert.equal(readPreferredAlgorithm(), 'legacy')
    assert.doesNotThrow(() => rememberAlgorithm('legacy'))
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete globalThis.localStorage
  }
})

test('表单转参数：经典模式关掉轮廓增强和主体优先，轮廓增强只在卡通主色下生效', async () => {
  const { buildConvertParams } = await import('./conversionSettings.ts')
  const form = { algorithm: 'perceptual-v1', mode: 'dominant', contourEnhance: true, subjectFocus: true,
    width: 40, height: 30, brandId: 'mard', dithering: false, mergeThreshold: 30 }
  assert.deepEqual(buildConvertParams(form), { algorithm: 'cartoon-v1', contourEnhance: true, subjectFocus: true,
    width: 40, height: 30, brandId: 'mard', dithering: false, edgeEnhance: true, mergeThreshold: 30, mode: 'dominant' })
  const realistic = buildConvertParams({ ...form, mode: 'average' })
  assert.equal(realistic.algorithm, 'perceptual-v1'); assert.equal(realistic.contourEnhance, false); assert.equal(realistic.subjectFocus, true)
  const classic = buildConvertParams({ ...form, algorithm: 'legacy' })
  assert.equal(classic.algorithm, 'legacy'); assert.equal(classic.contourEnhance, false); assert.equal(classic.subjectFocus, false)
})

test('转换结果转图纸：新图纸用新身份，重新转换保留原 id、名称和创建时间，且不共享数组', async () => {
  const { patternFromConversion } = await import('./conversionSettings.ts')
  const result = { grid: new Uint16Array([0, 1, 65535, 0]), paletteUsed: [7, 9] }
  const params = { algorithm: 'perceptual-v1', width: 2, height: 2, brandId: 'mard', dithering: false, edgeEnhance: true, mergeThreshold: 30, mode: 'average' }
  const fresh = patternFromConversion(result, params, { id: 'new', name: '新图纸' }, 'thumb')
  assert.equal(fresh.id, 'new'); assert.equal(fresh.width, 2); assert.equal(fresh.brandId, 'mard'); assert.equal(fresh.thumbnail, 'thumb')
  assert.equal(fresh.conversionAlgorithm, 'perceptual-v1'); assert.equal(fresh.conversionVersion, 'perceptual-1')
  assert.equal(fresh.createdAt, fresh.updatedAt)
  assert.deepEqual(Array.from(fresh.grid), [0, 1, 65535, 0]); assert.deepEqual(fresh.paletteUsed, [7, 9])
  assert.notEqual(fresh.grid, result.grid); assert.notEqual(fresh.paletteUsed, result.paletteUsed)
  const redo = patternFromConversion(result, params, { id: 'old', name: '我的图', createdAt: 5 }, '', 'legacy')
  assert.equal(redo.id, 'old'); assert.equal(redo.name, '我的图'); assert.equal(redo.createdAt, 5); assert.ok(redo.updatedAt > 5)
  assert.equal(redo.conversionAlgorithm, 'legacy'); assert.equal(redo.conversionParams.algorithm, 'legacy')
})
