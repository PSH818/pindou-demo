import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { BRAND_IDS, COLOR_SYSTEMS, type BeadColor } from '../types/index.ts'
import { BRAND_OPTIONS, deriveBrandColors, getColorSystemForBrand } from './palette.ts'

const source = JSON.parse(
  await readFile(new URL('../data/mard.json', import.meta.url), 'utf8'),
) as BeadColor[]

test('每个品牌 ID 都有且只有一份加载元数据', () => {
  assert.deepEqual(BRAND_OPTIONS.map(option => option.id), [...BRAND_IDS])
  assert.equal(new Set(BRAND_OPTIONS.map(option => option.id)).size, BRAND_IDS.length)
})

test('国产品牌色号按上游映射完整投影', () => {
  const expectedCounts = new Map([
    ['MARD', 291],
    ['COCO', 291],
    ['漫漫', 290],
    ['盼盼', 291],
    ['咪小窝', 291],
  ])

  for (const system of COLOR_SYSTEMS) {
    const colors = deriveBrandColors(source, system)
    assert.equal(colors.length, expectedCounts.get(system), `${system} 色数异常`)
    assert.equal(new Set(colors.map(color => color.id)).size, colors.length, `${system} 存在重复颜色 ID`)
    assert.ok(colors.every(color => color.code !== '-' && color.code === color.name))
  }
})

test('品牌入口使用对应色号系统，Artkal 保持独立色板', () => {
  assert.equal(getColorSystemForBrand('mard'), 'MARD')
  assert.equal(getColorSystemForBrand('coco'), 'COCO')
  assert.equal(getColorSystemForBrand('manman'), '漫漫')
  assert.equal(getColorSystemForBrand('panpan'), '盼盼')
  assert.equal(getColorSystemForBrand('mixiaowo'), '咪小窝')
  assert.equal(getColorSystemForBrand('artkal_c'), null)
})

test('品牌投影不修改共享基准色', () => {
  const original = source[0].code
  const coco = deriveBrandColors(source, 'COCO')
  assert.equal(source[0].code, original)
  assert.equal(coco[0].code, source[0].brandCodes?.COCO)
  assert.notEqual(coco[0], source[0])
})
