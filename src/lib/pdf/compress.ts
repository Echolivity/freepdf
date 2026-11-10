import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFNull,
  decodePDFRawStream,
  type PDFObject,
  type PDFContext,
} from 'pdf-lib'
import pako from 'pako'
import { loadPdf, saveDoc, noProgress, type NamedBytes, type ProgressFn } from './core'
import { removeUnreachable } from './structure'
import { msg } from '../../i18n/core'
export { removeUnreachable }

/** 'lossless' never touches image pixels; the other levels re-encode photos (lossy). */
export type CompressionLevel = 'lossless' | 'light' | 'balanced' | 'strong'

export interface EncodedImage {
  bytes: Uint8Array
  width: number
  height: number
}

/**
 * Image re-encoder. In the browser this is backed by OffscreenCanvas (see workers/codec.ts).
 * Output is always an 8-bit RGB baseline JPEG.
 */
export interface ImageCodec {
  recompressJpeg(jpeg: Uint8Array, maxDim: number, quality: number): Promise<EncodedImage | null>
  encodeRaw(pixels: Uint8Array, width: number, height: number, components: 1 | 3, maxDim: number, quality: number): Promise<EncodedImage | null>
}

export const LEVELS: Record<CompressionLevel, { quality: number; maxDim: number; convertLossless: boolean; lossy: boolean }> = {
  // Repacks the file (object streams, deflates uncompressed data, drops leftovers). Pixels untouched.
  lossless: { quality: 1, maxDim: Number.POSITIVE_INFINITY, convertLossless: false, lossy: false },
  // Lossless restructuring plus gentle re-encoding of oversized photos.
  // All levels are lossy for photos; "light" only touches JPEG photos and never downscales below 3500px.
  light: { quality: 0.85, maxDim: 3500, convertLossless: false, lossy: true },
  balanced: { quality: 0.72, maxDim: 2200, convertLossless: true, lossy: true },
  strong: { quality: 0.55, maxDim: 1500, convertLossless: true, lossy: true },
}

/** Why an image was left exactly as it was. */
export type SkipReason =
  | 'transparency' // has a soft mask / colour-key mask: re-encoding could misalign or flatten it
  | 'colourSpace' // CMYK, Indexed, Lab, Separation… can't round-trip through an RGB canvas faithfully
  | 'keptLossless' // lossless image at the Light level, which only touches photos
  | 'losslessMode' // Lossless level: no image is re-encoded
  | 'small' // too small to be worth it
  | 'encoding' // unusual bit depth, decode array or filter chain
  | 'noGain' // re-encoding didn't save at least 10%
  | 'decodeFailed' // the browser couldn't decode it

export interface CompressReport {
  /** Images found (soft-mask channels are counted as part of their image, not separately). */
  images: number
  recompressed: number
  skipped: Record<SkipReason, number>
  /** Uncompressed non-image streams that were losslessly deflated. */
  streamsDeflated: number
  /** Unreachable objects (leftovers of earlier edits) removed. */
  objectsRemoved: number
}

export interface CompressResult {
  bytes: Uint8Array
  originalSize: number
  /** True when no smaller version could be produced and the original bytes were returned. */
  unchanged: boolean
  imagesRecompressed: number
  report: CompressReport
}

const emptySkips = (): Record<SkipReason, number> => ({ transparency: 0, colourSpace: 0, keptLossless: 0, losslessMode: 0, small: 0, encoding: 0, noGain: 0, decodeFailed: 0 })

const N = (s: string) => PDFName.of(s)
/** Only bother with images whose stream is at least this large. */
const MIN_IMAGE_BYTES = 12 * 1024
/** Require at least this saving before swapping an image. */
const MIN_GAIN = 0.9

export async function compressPdf(
  input: NamedBytes,
  level: CompressionLevel,
  codec: ImageCodec | null,
  onProgress: ProgressFn = noProgress,
): Promise<CompressResult> {
  const cfg = LEVELS[level]
  const doc = await loadPdf(input.bytes, input.name)
  const ctx = doc.context
  onProgress(0.05, msg('prog.analysing'))

  const report: CompressReport = { images: 0, recompressed: 0, skipped: emptySkips(), streamsDeflated: 0, objectsRemoved: removeUnreachable(ctx) }

  const entries = ctx.enumerateIndirectObjects()
  // Soft masks are images too, but must stay single-channel; never re-encode them.
  const softMasks = new Set<string>()
  for (const [, obj] of entries) {
    if (obj instanceof PDFRawStream) {
      const sm = obj.dict.get(N('SMask'))
      if (sm instanceof PDFRef) softMasks.add(sm.toString())
    }
  }
  for (let i = 0; i < entries.length; i++) {
    const [ref, obj] = entries[i]
    if (i % 25 === 0) onProgress(0.05 + 0.85 * (i / entries.length), msg('prog.optimising'))
    if (!(obj instanceof PDFRawStream)) continue
    const dict = obj.dict
    if (dict.get(N('Subtype')) === N('Image')) {
      if (softMasks.has(ref.toString())) continue // part of another image
      report.images++
      const outcome = !cfg.lossy ? 'losslessMode' : codec ? await recompressImage(ctx, ref, obj, codec, cfg) : 'encoding'
      if (outcome === 'ok') report.recompressed++
      else report.skipped[outcome]++
    } else if (deflateIfUncompressed(ctx, ref, obj)) {
      report.streamsDeflated++
    }
  }

  onProgress(0.93, msg('prog.saving'))
  const bytes = await saveDoc(doc)
  onProgress(1)
  if (bytes.length >= input.bytes.length) {
    return { bytes: input.bytes, originalSize: input.bytes.length, unchanged: true, imagesRecompressed: 0, report }
  }
  return { bytes, originalSize: input.bytes.length, unchanged: false, imagesRecompressed: report.recompressed, report }
}

function filterNames(dict: PDFDict): string[] | null {
  const f = dict.lookup(N('Filter'))
  if (!f) return []
  if (f instanceof PDFName) return [f.decodeText()]
  if (f instanceof PDFArray) {
    const names: string[] = []
    for (const v of f.asArray()) {
      if (!(v instanceof PDFName)) return null
      names.push(v.decodeText())
    }
    return names
  }
  return null
}

function deflateIfUncompressed(ctx: PDFContext, ref: PDFRef, stream: PDFRawStream): boolean {
  const dict = stream.dict
  const filters = filterNames(dict)
  if (!filters || filters.length) return false
  // XMP metadata is conventionally left readable; tiny streams don't benefit.
  if (dict.get(N('Type')) === N('Metadata') || stream.contents.length < 256) return false
  const deflated = pako.deflate(stream.contents)
  if (deflated.length >= stream.contents.length * MIN_GAIN) return false
  dict.set(N('Filter'), N('FlateDecode'))
  ctx.assign(ref, PDFRawStream.of(dict, deflated))
  return true
}

function num(dict: PDFDict, key: string): number | undefined {
  const v = dict.lookup(N(key))
  return v instanceof PDFNumber ? v.asNumber() : undefined
}

/** Number of colour components for DeviceGray/DeviceRGB/ICCBased(1|3); null for anything else. */
function components(ctx: PDFContext, dict: PDFDict): { n: 1 | 3; keepColorSpace: boolean } | null {
  const cs = dict.lookup(N('ColorSpace'))
  if (cs === N('DeviceRGB')) return { n: 3, keepColorSpace: true }
  if (cs === N('DeviceGray')) return { n: 1, keepColorSpace: false }
  if (cs instanceof PDFArray && cs.size() === 2 && cs.lookup(0) === N('ICCBased')) {
    const icc = ctx.lookup(cs.get(1))
    const n = icc instanceof PDFStream ? num(icc.dict, 'N') : undefined
    if (n === 3) return { n: 3, keepColorSpace: true }
    if (n === 1) return { n: 1, keepColorSpace: false }
  }
  return null
}

async function recompressImage(
  ctx: PDFContext,
  ref: PDFRef,
  stream: PDFRawStream,
  codec: ImageCodec,
  cfg: (typeof LEVELS)[CompressionLevel],
): Promise<'ok' | SkipReason> {
  const dict = stream.dict
  // Images with transparency are left alone so the mask and the image can never get out of step.
  if (dict.lookup(N('SMask')) || dict.lookup(N('Mask')) || dict.lookup(N('SMaskInData'))) return 'transparency'
  if (dict.lookup(N('ImageMask'))) return 'encoding'
  if (stream.contents.length < MIN_IMAGE_BYTES) return 'small'
  const comp = components(ctx, dict)
  if (!comp) return 'colourSpace'
  // Decode arrays and non-8-bit samples don't survive lossy re-encoding faithfully.
  if (dict.lookup(N('Decode')) || num(dict, 'BitsPerComponent') !== 8) return 'encoding'
  const width = num(dict, 'Width')
  const height = num(dict, 'Height')
  if (!width || !height || width * height > 100_000_000) return 'encoding'
  const filters = filterNames(dict)
  if (!filters || !filters.length) return 'encoding'
  const isJpeg = filters[filters.length - 1] === 'DCTDecode' && filters.slice(0, -1).every((f) => TRANSPORT_FILTERS.has(f))
  const isLossless = !isJpeg && filters.every((f) => TRANSPORT_FILTERS.has(f))
  if (!isJpeg && !isLossless) return 'encoding' // JPX, JBIG2, CCITT…
  if (isLossless && !cfg.convertLossless) return 'keptLossless'

  let encoded: EncodedImage | null = null
  try {
    if (isJpeg) {
      const jpeg = filters.length === 1 ? stream.contents : stripTransportFilters(stream, filters.slice(0, -1))
      const needsResize = Math.max(width, height) > cfg.maxDim
      encoded = await codec.recompressJpeg(jpeg, needsResize ? cfg.maxDim : Math.max(width, height), cfg.quality)
      if (!encoded) return 'colourSpace' // e.g. a CMYK/YCCK JPEG declared as RGB
    } else {
      const raw = decodeLosslessImage(stream, filters, width, height, comp.n)
      if (!raw) return 'encoding'
      encoded = await codec.encodeRaw(raw, width, height, comp.n, cfg.maxDim, cfg.quality)
    }
  } catch {
    return 'decodeFailed' // undecodable image: leave it exactly as it was
  }
  if (!encoded || encoded.bytes.length >= stream.contents.length * MIN_GAIN) return 'noGain'

  dict.set(N('Filter'), N('DCTDecode'))
  dict.delete(N('DecodeParms'))
  dict.set(N('Width'), PDFNumber.of(encoded.width))
  dict.set(N('Height'), PDFNumber.of(encoded.height))
  dict.set(N('BitsPerComponent'), PDFNumber.of(8))
  if (!comp.keepColorSpace) dict.set(N('ColorSpace'), N('DeviceRGB'))
  ctx.assign(ref, PDFRawStream.of(dict, encoded.bytes))
  return 'ok'
}

/** Encodings that wrap a JPEG without changing it (e.g. ReportLab's [/ASCII85Decode /DCTDecode]). */
const TRANSPORT_FILTERS = new Set(['ASCII85Decode', 'ASCIIHexDecode', 'FlateDecode', 'LZWDecode', 'RunLengthDecode'])

function stripTransportFilters(stream: PDFRawStream, filters: string[]): Uint8Array {
  const dict = PDFDict.withContext(stream.dict.context)
  dict.set(N('Filter'), filters.length === 1 ? N(filters[0]) : stream.dict.context.obj(filters.map((f) => N(f))))
  return decodePDFRawStream(PDFRawStream.of(dict, stream.contents)).decode()
}

/**
 * Decode a losslessly-compressed 8-bit image (any chain of Flate/LZW/ASCII85/ASCIIHex/RunLength),
 * undoing PNG predictors (10–15). Returns null for unsupported encodings.
 */
export function decodeLosslessImage(stream: PDFRawStream, filters: string[], width: number, height: number, comps: number): Uint8Array | null {
  const rawParms = stream.dict.lookup(N('DecodeParms'))
  // With a filter chain, DecodeParms is an array aligned with Filter; predictors live on Flate/LZW.
  let parms: PDFObject | undefined = rawParms
  if (rawParms instanceof PDFArray) {
    const idx = filters.findIndex((f) => f === 'FlateDecode' || f === 'LZWDecode')
    parms = idx >= 0 ? rawParms.lookup(idx) : undefined
    if (parms === PDFNull) parms = undefined
  }
  let predictor = 1
  if (parms instanceof PDFDict) {
    predictor = num(parms, 'Predictor') ?? 1
    const colors = num(parms, 'Colors') ?? 1
    const bpc = num(parms, 'BitsPerComponent') ?? 8
    const cols = num(parms, 'Columns') ?? 1
    if (predictor >= 10 && (colors !== comps || bpc !== 8 || cols !== width)) return null
  } else if (parms) {
    return null
  }
  if (predictor !== 1 && predictor < 10) return null // TIFF predictor: not worth supporting
  const decoded = decodePDFRawStream(stream).decode()
  const rowLen = width * comps
  if (predictor === 1) return decoded.length >= rowLen * height ? decoded.subarray(0, rowLen * height) : null
  return undoPngPredictor(decoded, rowLen, height, comps)
}

export function undoPngPredictor(data: Uint8Array, rowLen: number, height: number, bpp: number): Uint8Array | null {
  if (data.length < (rowLen + 1) * height) return null
  const out = new Uint8Array(rowLen * height)
  for (let y = 0; y < height; y++) {
    const type = data[y * (rowLen + 1)]
    const src = y * (rowLen + 1) + 1
    const dst = y * rowLen
    const prev = dst - rowLen
    for (let x = 0; x < rowLen; x++) {
      const raw = data[src + x]
      const a = x >= bpp ? out[dst + x - bpp] : 0
      const b = y > 0 ? out[prev + x] : 0
      const c = y > 0 && x >= bpp ? out[prev + x - bpp] : 0
      let v: number
      switch (type) {
        case 0: v = raw; break
        case 1: v = raw + a; break
        case 2: v = raw + b; break
        case 3: v = raw + ((a + b) >> 1); break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
          v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default: return null
      }
      out[dst + x] = v & 0xff
    }
  }
  return out
}
