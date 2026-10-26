// @ts-nocheck — Node test runner with browser boundary fakes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadImageInfo } from './analyzeImageLoader.ts'

async function withBrowser(mode, run, dimensions = [2, 3]) {
  const saved = ['Image','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])
  const state = { images: [], canvases: [], late: null }
  const ctx = {
    drawImage() { if(mode==='draw')throw new Error('draw failed') },
    getImageData() { if(mode==='read')throw new DOMException('pixel read failed','SecurityError');return {data:new Uint8ClampedArray(24).fill(71)} },
  }
  class FakeImage {
    naturalWidth=dimensions[0];naturalHeight=dimensions[1];onload=null;onerror=null
    constructor(){state.images.push(this)}
    set src(value) {
      if(mode==='source')throw new Error('source failed')
      state.late=this.onload
      if(mode==='hang')return
      queueMicrotask(()=>mode==='error'?this.onerror?.():this.onload?.())
    }
    removeAttribute(){this.removed=true}
  }
  try {
    Object.defineProperty(globalThis,'Image',{configurable:true,value:FakeImage})
    Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement(){
      const canvas={width:0,height:0,getContext:()=>mode==='context'?null:ctx}
      state.canvases.push(canvas);return canvas
    }}})
    await run(state)
  } finally {
    for(const [key,descriptor] of saved)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]
  }
}

test('成功读取独立像素缓冲，释放图片回调和离屏画布',async()=>{
  await withBrowser('ok',async state=>{
    const result=await loadImageInfo('fixture')
    assert.equal(result.width,2);assert.equal(result.height,3)
    assert.equal(new Uint8Array(result.imageData)[0],71)
    assert.equal(state.images[0].onload,null);assert.equal(state.images[0].onerror,null)
    assert.equal(state.canvases[0].width,0)
  })
})
test('图片加载和地址赋值失败返回明确错误',async()=>{
  for(const mode of ['error','source'])await withBrowser(mode,async()=>{
    await assert.rejects(loadImageInfo('fixture'),/图片加载失败/)
  })
})
test('画布上下文、绘制、像素读取异常均拒绝 Promise',async()=>{
  for(const mode of ['context','draw','read'])await withBrowser(mode,async state=>{
    await assert.rejects(loadImageInfo('fixture'),/图片读取失败/)
    assert.equal(state.images[0].onload,null);assert.equal(state.canvases[0].width,0)
  })
})
test('尺寸异常或超内存限制时在分配画布之前失败',async()=>{
  for(const dimensions of [[0,2],[20000,1],[8000,8000]])await withBrowser('ok',async state=>{
    await assert.rejects(loadImageInfo('fixture'),/图片尺寸/)
    assert.equal(state.canvases.length,0)
  },dimensions)
})
test('不触发加载事件时超时，不永久挂起，迟到事件无效',async()=>{
  await withBrowser('hang',async state=>{
    await assert.rejects(loadImageInfo('fixture',{timeoutMs:10}),/图片读取超时/)
    state.late()
    assert.equal(state.canvases.length,0)
    assert.equal(state.images[0].removed,true)
  })
})
test('读取前和读取中取消均结束 Promise，不执行迟到读取',async()=>{
  await withBrowser('hang',async state=>{
    const first=new AbortController();first.abort()
    await assert.rejects(loadImageInfo('fixture',{signal:first.signal}),{name:'AbortError'})
    assert.equal(state.images.length,0)
    const next=new AbortController()
    const pending=loadImageInfo('fixture',{signal:next.signal})
    next.abort()
    await assert.rejects(pending,{name:'AbortError'})
    state.late()
    assert.equal(state.canvases.length,0)
  })
})
