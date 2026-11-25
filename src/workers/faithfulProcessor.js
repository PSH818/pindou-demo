// 保真模式的 Worker 入口：普通保真与轮廓增强共用，按 params.algorithm 分流。
// 只做消息收发和取景，冻结的 perceptualCore 实现不在这里改动。
import { convertCartoon, frameSubject } from './cartoonCore.js'
import { convertPerceptual } from './perceptualCore.js'

function convertFaithful(data, progress) {
  // Validate before optional framing allocates or indexes the source buffer.
  const { imageWidth: w, imageHeight: h } = data
  if (![w, h].every(n => Number.isInteger(n) && n > 0) || w * h > 16000000 || data.imageData.byteLength !== w * h * 4) throw new Error('图像尺寸无效')
  return convertPerceptual(data.params.subjectFocus ? frameSubject(data) : data, progress)
}

self.onmessage = ({ data }) => {
  if (data.type !== 'convert') return
  try {
    const progress = value => self.postMessage({ type: 'progress', progress: value })
    const result = data.params.algorithm === 'cartoon-v1' ? convertCartoon(data, progress) : convertFaithful(data, progress)
    self.postMessage({ type: 'result', grid: result.grid.buffer, paletteUsed: result.paletteUsed }, [result.grid.buffer])
  } catch (error) {
    self.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}
