import type { EncodedImage, ImageCodec } from '../lib/pdf/compress'
import { LIMITS } from '../config'

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

/** Number of colour components declared in a JPEG's SOF segment (null if not found). */
export function jpegComponents(b: Uint8Array): number | null {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const m = b[i + 1]
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue }
    const len = (b[i + 2] << 8) | b[i + 3]
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return b[i + 9]
    i += 2 + len
  }
  return null
}

function assertSafeDimensions(w: number, h: number) {
  if (w * h > LIMITS.maxImagePixels) throw new Error('Image too large to process safely')
}

export const canvasCodec: ImageCodec = {
  async recompressJpeg(jpeg, maxDim, quality): Promise<EncodedImage | null> {
    // CMYK/YCCK JPEGs can't be faithfully round-tripped through an RGB canvas.
    const comps = jpegComponents(jpeg)
    if (comps !== 3 && comps !== 1) return null
    // colorSpaceConversion 'none': pixel values pass through unchanged, so the PDF's own colour space /
    // ICC profile (kept on the image dictionary) still describes them correctly after re-encoding.
    const bitmap = await createImageBitmap(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }), { imageOrientation: 'none', colorSpaceConversion: 'none' })
    try {
      assertSafeDimensions(bitmap.width, bitmap.height)
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

/** Encode decoded RGBA pixels (a TIFF page) as PNG, or as JPEG when asked and the page is opaque. */
export async function encodeRgba(rgba: Uint8Array, w: number, h: number, as: 'png' | 'jpeg', quality = 0.9): Promise<Uint8Array> {
  assertSafeDimensions(w, h)
  const canvas = new OffscreenCanvas(w, h)
  ctx2d(canvas).putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, w * h * 4), w, h), 0, 0)
  const blob = await canvas.convertToBlob(as === 'jpeg' ? { type: 'image/jpeg', quality } : { type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

/** Convert any browser-decodable image (WebP) to PNG so pdf-lib can embed it losslessly. */
export async function toPng(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }))
  try {
    assertSafeDimensions(bitmap.width, bitmap.height)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    ctx2d(canvas).drawImage(bitmap, 0, 0)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    bitmap.close()
  }
}
