import { UserFacingError } from '../validate'
import { LIMITS } from '../../config'

/** One decoded TIFF page: 8-bit RGBA pixels plus what's needed to size it on a PDF page. */
export interface TiffPage {
  width: number
  height: number
  rgba: Uint8Array
  /** Pixels per inch from the file, if it states one (otherwise the caller assumes 96). */
  dpi: number | null
  /** True when any pixel is not fully opaque. */
  alpha: boolean
  /** TIFF compression code (1 none, 3/4 CCITT fax, 5 LZW, 6/7 JPEG, 8/32946 Deflate, 32773 PackBits). */
  compression: number
  /** Photometric interpretation 0/1 (bilevel or greyscale), 2 RGB, 3 palette, … */
  photometric: number
}

type Ifd = Record<string, unknown> & { width?: number; height?: number }
type Utif = {
  decode(buf: ArrayBuffer): Ifd[]
  decodeImage(buf: ArrayBuffer, ifd: Ifd): void
  toRGBA8(ifd: Ifd): Uint8Array
}

let utif: Promise<Utif> | null = null
/** Loaded on first use only, so other tools never download the decoder. */
const loadUtif = () => (utif ??= import('utif2').then((m) => ((m as { default?: Utif }).default ?? (m as unknown as Utif))))

const num = (v: unknown): number | null => (Array.isArray(v) && typeof v[0] === 'number' ? v[0] : typeof v === 'number' ? v : null)

/** Pixels per inch from XResolution (282) and ResolutionUnit (296: 2 = inch, 3 = centimetre). */
function dpiOf(ifd: Ifd): number | null {
  // Rationals come as [[numerator, denominator]].
  const r = Array.isArray(ifd.t282) ? (ifd.t282[0] as unknown) : null
  const x = Array.isArray(r) && typeof r[0] === 'number' && typeof r[1] === 'number' && r[1] > 0 ? r[0] / r[1] : num(ifd.t282)
  if (!x || !Number.isFinite(x) || x <= 0) return null
  const unit = num(ifd.t296) ?? 2
  const dpi = unit === 3 ? x * 2.54 : unit === 1 ? null : x
  // Ignore nonsense such as 1 dpi (a 2000 px scan would be a 28-metre page) or 72000 dpi.
  return dpi && dpi >= 20 && dpi <= 4800 ? dpi : null
}

/** Main images only: thumbnails and reduced-resolution copies (NewSubfileType bit 0) are skipped. */
function isMainImage(ifd: Ifd): boolean {
  const kind = num(ifd.t254) ?? 0
  return (kind & 1) === 0 && !!num(ifd.t256) && !!num(ifd.t257)
}

/** Number of pages and their sizes, without decompressing any pixels. */
export async function tiffInfo(bytes: Uint8Array): Promise<{ width: number; height: number }[]> {
  const UTIF = await loadUtif()
  let ifds: Ifd[]
  try {
    ifds = UTIF.decode(toArrayBuffer(bytes))
  } catch {
    throw new UserFacingError('err.tiffBroken')
  }
  return ifds.filter(isMainImage).map((i) => ({ width: num(i.t256)!, height: num(i.t257)! }))
}

/**
 * Decode every page of a TIFF, one at a time (each page is handed to `onPage` and can be dropped
 * before the next is decoded, so a 200-page fax never sits in memory at once).
 */
export async function decodeTiff(
  bytes: Uint8Array,
  name: string,
  onPage: (page: TiffPage, index: number, total: number) => Promise<void>,
): Promise<number> {
  const UTIF = await loadUtif()
  const buf = toArrayBuffer(bytes)
  let pages: Ifd[]
  try {
    pages = UTIF.decode(buf).filter(isMainImage)
  } catch {
    throw new UserFacingError('err.tiffBrokenNamed', { name })
  }
  if (!pages.length) throw new UserFacingError('err.tiffBrokenNamed', { name })
  for (let i = 0; i < pages.length; i++) {
    const ifd = pages[i]
    const w = num(ifd.t256)!
    const h = num(ifd.t257)!
    if (w * h > LIMITS.maxImagePixels) throw new UserFacingError('err.tiffTooBig', { name, page: i + 1, w, h })
    let rgba: Uint8Array
    try {
      UTIF.decodeImage(buf, ifd)
      rgba = UTIF.toRGBA8(ifd)
    } catch {
      throw new UserFacingError('err.tiffPage', { name, page: i + 1 })
    }
    if (!ifd.width || !ifd.height || rgba.length < ifd.width * ifd.height * 4) throw new UserFacingError('err.tiffPage', { name, page: i + 1 })
    let alpha = false
    for (let p = 3; p < rgba.length; p += 4) if (rgba[p] !== 255) { alpha = true; break }
    await onPage(
      { width: ifd.width, height: ifd.height, rgba, dpi: dpiOf(ifd), alpha, compression: num(ifd.t259) ?? 1, photometric: num(ifd.t262) ?? 2 },
      i,
      pages.length,
    )
    // Let the decoded strips go before the next page.
    delete (ifd as Record<string, unknown>).data
  }
  return pages.length
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer)
}
