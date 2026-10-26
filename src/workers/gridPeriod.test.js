import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGridProfile, detectGridPeriod } from './gridPeriod.js'

function fixture(cols=10, rows=8, cw=20, ch=20, thickness=3, options={}) {
  const cropW=Math.round(cols*cw),cropH=Math.round(rows*ch)
  const ox=options.offset??0,oy=options.offset??0,w=cropW+ox+7,h=cropH+oy+7
  const rgba=new Uint8ClampedArray(w*h*4)
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const rx=x-ox,ry=y-oy
    const col=Math.floor(rx/cw),row=Math.floor(ry/ch)
    const tw=options.major && col%5===0 ? thickness*2 : thickness
    const th=options.major && row%5===0 ? thickness*2 : thickness
    const line=rx>=0 && ry>=0 && (rx-Math.round(col*cw)<tw || ry-Math.round(row*ch)<th)
    const bg=options.mixed ? 100+(col*19+row*23)%140 : 230
    const value=options.invert ? (line?240:20) : (line?20:bg)
    rgba.set([value,value,value,255],(y*w+x)*4)
  }
  return [true,false].map(axis=>{
    const p=buildGridProfile(rgba,w,h,ox,oy,cropW,cropH,axis)
    const period=detectGridPeriod(p)
    return period ? Math.round((axis?cropW:cropH)/period):0
  })
}

test('线宽 1–8 像素均识别完整格距，不把线宽当成格宽',()=>{
  for(const thickness of [1,2,3,4,5,8])assert.deepEqual(fixture(10,8,20,20,thickness),[10,8],`line ${thickness}`)
})
test('横竖不同格距、格数及非零裁剪位置',()=>{
  for(const [cols,rows,cw,ch] of [[7,13,12,24],[30,20,8,10],[12,9,40,30]]) {
    assert.deepEqual(fixture(cols,rows,cw,ch,2,{offset:11}),[cols,rows])
  }
})
test('非整数缩放格距不被双倍周期或舍入漂移误导',()=>{
  assert.deepEqual(fixture(13,11,20.5,17.5,3),[13,11])
})
test('亮网格深底、多色底和每五格加粗线',()=>{
  for(const options of [{invert:true},{mixed:true},{major:true}])assert.deepEqual(fixture(20,15,20,20,2,options),[20,15])
})
test('采样间距与格距整除时仍能找到网格',()=>{
  assert.deepEqual(fixture(80,80,20,20,3),[80,80])
})
test('少量格子、小格距与编辑器最大格数边界',()=>{
  for(const [cols,rows,cw,ch,line] of [[3,4,20,20,3],[40,30,3,4,1],[200,150,6,8,1]]) {
    assert.deepEqual(fixture(cols,rows,cw,ch,line),[cols,rows])
  }
})
test('平坦、随机和不够三个周期的输入拒绝自动推断',()=>{
  assert.equal(detectGridPeriod(new Float32Array(200)),0)
  assert.equal(detectGridPeriod(new Float32Array([0,20,-20,0,20,-20])),0)
  let seed=123
  const noise=Float32Array.from({length:400},()=>{seed=(seed*1664525+1013904223)>>>0;return (seed/2**32-.5)*200})
  assert.equal(detectGridPeriod(noise),0)
})
test('透明像素中隐藏的 RGB 不形成虚假网格',()=>{
  const rgba=new Uint8ClampedArray(200*160*4)
  for(let i=0;i<rgba.length;i+=4) {
    rgba[i]=(i%17)*15;rgba[i+1]=(i%11)*20;rgba[i+2]=(i%7)*30
  }
  for(const axis of [true,false]) {
    const profile=buildGridProfile(rgba,200,160,0,0,200,160,axis)
    assert.ok(profile.every(v=>v===0))
    assert.equal(detectGridPeriod(profile),0)
  }
})
