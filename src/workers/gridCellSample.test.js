import test from 'node:test'
import assert from 'node:assert/strict'
import { sampleCellBackground } from './gridCellSample.js'

const make = (w, h, pixel) => new Uint8ClampedArray(Array.from({ length: w * h }, (_, i) => pixel(i % w, Math.floor(i / w))).flat())
const sample = (rgba, w = 20, h = 20) => sampleCellBackground(rgba, w, h, 0, 0, w, h)
const backgrounds = [[251,237,86], [8,12,16], [255,255,255], [180,40,80]]

test('格内文字：浅底黑字、深底白字不改变底色', () => {
  for (const bg of backgrounds) {
    const ink = bg[0] < 20 ? [255,255,255] : [0,0,0]
    const pixels = make(20,20,(x,y) => [...(x >= 4 && x <= 15 && y >= 7 && y <= 12 ? ink : bg),255])
    assert.deepEqual(sample(pixels), bg)
  }
})

test('格内采样排除粗边框，不把文字与底色平均成第三种色', () => {
  const bg = [251,237,86]
  const pixels = make(20,20,(x,y) => [...(x < 3 || y < 3 || x >= 17 || y >= 17 || (x >= 8 && x <= 11 && y >= 6 && y <= 13) ? [0,0,0] : bg),255])
  assert.deepEqual(sample(pixels), bg)
})

test('压缩噪声跨量化边界仍聚合为底色', () => {
  const pixels = make(32,32,(x,y) => {
    if (y >= 11 && y < 21 && x >= 7 && x < 25) return [0,0,0,255]
    const noise = ((x * 17 + y * 7) % 7) - 3
    return [160+noise,192+noise,224+noise,255]
  })
  const result = sample(pixels,32,32)
  result.forEach((v,i) => assert.ok(Math.abs(v - [160,192,224][i]) <= 3))
})

test('无字纯色与不同尺寸保持精确，单像素格不串入邻格', () => {
  for (const size of [1,2,3,8,20,100]) {
    for (const bg of backgrounds) assert.deepEqual(sample(make(size,size,() => [...bg,255]),size,size),bg)
  }
  const pixels = make(3,1,x => [...backgrounds[x],255])
  for (let x=0;x<3;x++) assert.deepEqual(sampleCellBackground(pixels,3,1,x,0,1,1),backgrounds[x])
})

test('非整数网格和非零裁剪偏移不采到相邻颜色', () => {
  const pixels = make(25,19,(x,y) => [...(x>=7 && x<18 && y>=5 && y<14 ? [251,237,86] : [0,0,0]),255])
  assert.deepEqual(sampleCellBackground(pixels,25,19,7.2,5.1,10.5,8.5),[251,237,86])
})

test('透明噪声不污染有效底色，全透明格返回空格而不是白色', () => {
  assert.deepEqual(sample(make(20,20,(x,y) => x%3===0 ? [255,0,255,0] : [8,12,16,255])),[8,12,16])
  assert.equal(sample(make(20,20,() => [0,0,0,0])),null)
  assert.equal(sample(make(20,20,() => [255,255,255,0])),null)
})

test('透明底上的稀疏文字和网格边缘不生成珠子', () => {
  assert.equal(sample(make(20,20,(x,y) => [0,0,0,x<3||y<3||(x>8&&x<12&&y>6&&y<13)?255:0])),null)
})

test('半透明阈值和半格覆盖规则明确，白色实体格不能被删除', () => {
  for (const alpha of [0,1,127]) assert.equal(sample(make(20,20,()=>[255,255,255,alpha])),null)
  for (const alpha of [128,200,255]) assert.deepEqual(sample(make(20,20,()=>[255,255,255,alpha])),[255,255,255])
  assert.deepEqual(sample(make(20,20,(x)=>[251,237,86,x>=10?255:0])),[251,237,86])
  assert.equal(sample(make(20,20,(x)=>[251,237,86,x>=11?255:0])),null)
})

test('相邻透明与不透明的单像素格不串色', () => {
  const rgba=make(3,1,x=>x===1?[255,255,255,255]:[200,10,40,0])
  assert.equal(sampleCellBackground(rgba,3,1,0,0,1,1),null)
  assert.deepEqual(sampleCellBackground(rgba,3,1,1,0,1,1),[255,255,255])
  assert.equal(sampleCellBackground(rgba,3,1,2,0,1,1),null)
})
