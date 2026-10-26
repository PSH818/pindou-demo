// Framing adapter only; the frozen perceptual implementation is unchanged.
import { frameSubject } from './cartoonCore.js'
import { convertPerceptual } from './perceptualCore.js'

self.onmessage = ({ data }) => {
  if (data.type !== 'convert') return
  try {
    // Validate before optional framing allocates or indexes the source buffer.
    const { imageWidth: w, imageHeight: h } = data
    if (![w, h].every(n => Number.isInteger(n) && n > 0) || w * h > 16000000 || data.imageData.byteLength !== w * h * 4) throw new Error('图像尺寸无效')
    const message = data.params.subjectFocus ? frameSubject(data) : data
    const result = convertPerceptual(message, progress => self.postMessage({ type: 'progress', progress }))
    self.postMessage({ type: 'result', grid: result.grid.buffer, paletteUsed: result.paletteUsed }, [result.grid.buffer])
  } catch (error) {
    self.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}
