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
