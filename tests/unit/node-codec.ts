import { createCanvas, loadImage, ImageData } from '@napi-rs/canvas'
import type { EncodedImage, ImageCodec } from '../../src/lib/pdf/compress'
import { jpegComponents } from '../../src/workers/codec'

/**
 * A real JPEG encoder for Node tests (Skia via @napi-rs/canvas), mirroring the browser's OffscreenCanvas
 * codec in src/workers/codec.ts: same component check, same downscale rule, same quality semantics.
 * No stubbing — sizes and pixels in compression tests are genuine.
 */
function fit(w: number, h: number, maxDim: number) {
  const k = Math.min(1, maxDim / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) }
}

export const nodeCodec: ImageCodec = {
  async recompressJpeg(jpeg, maxDim, quality): Promise<EncodedImage | null> {
    const comps = jpegComponents(jpeg)
    if (comps !== 3 && comps !== 1) return null
    const img = await loadImage(Buffer.from(jpeg))
    const { width, height } = fit(img.width, img.height, maxDim)
    const canvas = createCanvas(width, height)
    canvas.getContext('2d').drawImage(img, 0, 0, width, height)
    return { bytes: new Uint8Array(await canvas.encode('jpeg', Math.round(quality * 100))), width, height }
  },
  async encodeRaw(pixels, w, h, comps, maxDim, quality): Promise<EncodedImage | null> {
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let i = 0, j = 0; i < w * h; i++, j += comps) {
      const o = i * 4
      if (comps === 3) { rgba[o] = pixels[j]; rgba[o + 1] = pixels[j + 1]; rgba[o + 2] = pixels[j + 2] } else { rgba[o] = rgba[o + 1] = rgba[o + 2] = pixels[j] }
      rgba[o + 3] = 255
    }
    const full = createCanvas(w, h)
    full.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0)
    const { width, height } = fit(w, h, maxDim)
    const canvas = width === w && height === h ? full : createCanvas(width, height)
    if (canvas !== full) canvas.getContext('2d').drawImage(full, 0, 0, width, height)
    return { bytes: new Uint8Array(await canvas.encode('jpeg', Math.round(quality * 100))), width, height }
  },
}
