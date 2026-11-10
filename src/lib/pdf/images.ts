import { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject, type PDFImage } from 'pdf-lib'
import { UserFacingError } from '../validate'
import { msg } from '../../i18n/core'
import { saveDoc, noProgress, type ProgressFn } from './core'

export interface ImageInput {
  name: string
  bytes: Uint8Array
  /** jpeg or png. WebP must be converted to PNG by the caller (browser) before reaching here. */
  kind: 'jpeg' | 'png'
}

export type PageSize = 'fit' | 'a4' | 'letter'
export type Orientation = 'auto' | 'portrait' | 'landscape'

export interface ImagesToPdfOptions {
  pageSize: PageSize
  orientation: Orientation
  /** Margin in PDF points (1/72 inch). */
  margin: number
}

const SIZES: Record<Exclude<PageSize, 'fit'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
}

/** CSS pixels → PDF points, assuming 96 DPI (what browsers and most viewers assume). */
const PX_TO_PT = 0.75

/** Read the EXIF orientation tag (1–8) from a JPEG; 1 if absent. */
export function jpegOrientation(bytes: Uint8Array): number {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.getUint16(0) !== 0xffd8) return 1
  let off = 2
  while (off + 4 < bytes.length) {
    const marker = dv.getUint16(off)
    if ((marker & 0xff00) !== 0xff00) return 1
    const len = dv.getUint16(off + 2)
    if (marker === 0xffe1 && dv.getUint32(off + 4) === 0x45786966 /* "Exif" */) {
      const tiff = off + 10
      if (tiff + 8 > bytes.length) return 1
      const little = dv.getUint16(tiff) === 0x4949
      const ifd = tiff + dv.getUint32(tiff + 4, little)
      if (ifd + 2 > bytes.length) return 1
      const entries = dv.getUint16(ifd, little)
      for (let i = 0; i < entries; i++) {
        const e = ifd + 2 + i * 12
        if (e + 10 > bytes.length) return 1
        if (dv.getUint16(e, little) === 0x0112) {
          const v = dv.getUint16(e + 8, little)
          return v >= 1 && v <= 8 ? v : 1
        }
      }
      return 1
    }
    if (marker === 0xffda) return 1 // start of scan: no more metadata
    off += 2 + len
  }
  return 1
}

/**
 * Matrix that draws the unit-square image into box (x, y, w, h) displayed upright for a given
 * EXIF orientation. Derived from mapping raw (u, v) to displayed (X, Y) in PDF's y-up space.
 */
function orientationMatrix(o: number, x: number, y: number, w: number, h: number): [number, number, number, number, number, number] {
  switch (o) {
    case 2: return [-w, 0, 0, h, x + w, y]
    case 3: return [-w, 0, 0, -h, x + w, y + h]
    case 4: return [w, 0, 0, -h, x, y + h]
    case 5: return [0, -h, -w, 0, x + w, y + h]
    case 6: return [0, -h, w, 0, x, y + h]
    case 7: return [0, h, w, 0, x, y]
    case 8: return [0, h, -w, 0, x + w, y]
    default: return [w, 0, 0, h, x, y]
  }
}

export async function imagesToPdf(
  images: ImageInput[],
  opts: ImagesToPdfOptions,
  onProgress: ProgressFn = noProgress,
): Promise<Uint8Array> {
  if (!images.length) throw new UserFacingError('err.imageNone')
  const doc = await PDFDocument.create()
  doc.setProducer('FreePDF')
  doc.setCreator('FreePDF')
  const margin = Math.max(0, Math.min(opts.margin, 144))

  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    onProgress(i / images.length, msg('prog.adding', { name: img.name }))
    let embedded: PDFImage
    try {
      embedded = img.kind === 'jpeg' ? await doc.embedJpg(img.bytes) : await doc.embedPng(img.bytes)
    } catch {
      throw new UserFacingError('err.imageBroken', { name: img.name })
    }
    const orientation = img.kind === 'jpeg' ? jpegOrientation(img.bytes) : 1
    const swap = orientation >= 5
    const natW = (swap ? embedded.height : embedded.width) * PX_TO_PT
    const natH = (swap ? embedded.width : embedded.height) * PX_TO_PT

    let pageW: number, pageH: number
    if (opts.pageSize === 'fit') {
      pageW = natW + margin * 2
      pageH = natH + margin * 2
    } else {
      const [sw, sh] = SIZES[opts.pageSize]
      const landscape = opts.orientation === 'landscape' || (opts.orientation === 'auto' && natW > natH)
      ;[pageW, pageH] = landscape ? [sh, sw] : [sw, sh]
    }
    // PDF viewers cap pages at 14400pt (200in); scale down huge images rather than produce a broken page.
    const maxSide = 14400
    if (pageW > maxSide || pageH > maxSide) {
      const k = maxSide / Math.max(pageW, pageH)
      pageW *= k
      pageH *= k
    }
    const boxW = pageW - margin * 2
    const boxH = pageH - margin * 2
    // Never upscale: small images stay crisp at their natural size, centred on the page.
    const scale = Math.min(boxW / natW, boxH / natH, 1)
    const w = natW * scale
    const h = natH * scale
    const x = (pageW - w) / 2
    const y = (pageH - h) / 2

    const page = doc.addPage([pageW, pageH])
    const xName = page.node.newXObject('Image', embedded.ref)
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(...orientationMatrix(orientation, x, y, w, h)),
      drawObject(xName),
      popGraphicsState(),
    )
  }
  onProgress(0.97, msg('prog.saving'))
  const out = await saveDoc(doc)
  onProgress(1)
  return out
}
