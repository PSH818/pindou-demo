import { convertPerceptual } from './perceptualCore.js'

self.onmessage = ({ data }) => {
  if (data.type !== 'convert') return
  try {
    const result = convertPerceptual(data, progress => self.postMessage({ type: 'progress', progress }))
    self.postMessage({ type: 'result', grid: result.grid.buffer, paletteUsed: result.paletteUsed }, [result.grid.buffer])
  } catch (error) {
    self.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}
