import type { EncodedImage, ImageCodec } from '../lib/pdf/compress'

/** Image codec built on OffscreenCanvas; works inside Web Workers in all current browsers. */

function fit(w: number, h: number, maxDim: number) {
  const k = Math.min(1, maxDim / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) }
}

async function canvasToJpeg(canvas: OffscreenCanvas, quality: number): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
  return new Uint8Array(await blob.arrayBuffer())
}

function ctx2d(canvas: OffscreenCanvas) {
  const c = canvas.getContext('2d')
  if (!c) throw new Error('2D canvas unavailable')
  return c
}

export const canvasCodec: ImageCodec = {
  async recompressJpeg(jpeg, maxDim, quality): Promise<EncodedImage | null> {
    const bitmap = await createImageBitmap(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }), { imageOrientation: 'none' })
    try {
      const { width, height } = fit(bitmap.width, bitmap.height, maxDim)
      const canvas = new OffscreenCanvas(width, height)
      const c = ctx2d(canvas)
      c.imageSmoothingQuality = 'high'
      c.drawImage(bitmap, 0, 0, width, height)
      return { bytes: await canvasToJpeg(canvas, quality), width, height }
    } finally {
      bitmap.close()
    }
  },

  async encodeRaw(pixels, w, h, comps, maxDim, quality): Promise<EncodedImage | null> {
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let i = 0, j = 0; i < w * h; i++, j += comps) {
      const o = i * 4
      if (comps === 3) {
        rgba[o] = pixels[j]; rgba[o + 1] = pixels[j + 1]; rgba[o + 2] = pixels[j + 2]
      } else {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = pixels[j]
      }
      rgba[o + 3] = 255
    }
    const full = new OffscreenCanvas(w, h)
    ctx2d(full).putImageData(new ImageData(rgba, w, h), 0, 0)
    const { width, height } = fit(w, h, maxDim)
    let canvas = full
    if (width !== w || height !== h) {
      canvas = new OffscreenCanvas(width, height)
      const c = ctx2d(canvas)
      c.imageSmoothingQuality = 'high'
      c.drawImage(full, 0, 0, width, height)
    }
    return { bytes: await canvasToJpeg(canvas, quality), width, height }
  },
}

/** Convert any browser-decodable image (WebP) to PNG so pdf-lib can embed it losslessly. */
export async function toPng(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }))
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    ctx2d(canvas).drawImage(bitmap, 0, 0)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    bitmap.close()
  }
}
