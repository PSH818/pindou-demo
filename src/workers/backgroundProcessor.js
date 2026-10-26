import { removeFlatBackground } from './flatBackground.js'

self.onmessage = ({ data }) => {
  try {
    const result = removeFlatBackground(new Uint8ClampedArray(data.imageData), data.width, data.height)
    if (!result) { self.postMessage({ type: 'fallback' }); return }
    self.postMessage({ type: 'result', rgba: result.rgba.buffer }, [result.rgba.buffer])
  } catch (error) {
    self.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}
