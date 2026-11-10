import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  type PDFContext,
} from 'pdf-lib'
import pako from 'pako'
import { loadPdf, saveDoc, noProgress, type NamedBytes, type ProgressFn } from './core'
import { removeUnreachable } from './structure'
import { msg } from '../../i18n/core'
export { removeUnreachable }

export type CompressionLevel = 'light' | 'balanced' | 'strong'

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

export const LEVELS: Record<CompressionLevel, { quality: number; maxDim: number; convertLossless: boolean }> = {
  // Lossless restructuring plus gentle re-encoding of oversized photos.
  // All levels are lossy for photos; "light" only touches JPEG photos and never downscales below 3500px.
  light: { quality: 0.85, maxDim: 3500, convertLossless: false },
  balanced: { quality: 0.72, maxDim: 2200, convertLossless: true },
  strong: { quality: 0.55, maxDim: 1500, convertLossless: true },
}

export interface CompressResult {
  bytes: Uint8Array
  originalSize: number
  /** True when no smaller version could be produced and the original bytes were returned. */
  unchanged: boolean
  imagesRecompressed: number
}

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

  removeUnreachable(ctx)

  const entries = ctx.enumerateIndirectObjects()
  // Soft masks are images too, but must stay single-channel; never re-encode them.
  const softMasks = new Set<string>()
  for (const [, obj] of entries) {
    if (obj instanceof PDFRawStream) {
      const sm = obj.dict.get(N('SMask'))
      if (sm instanceof PDFRef) softMasks.add(sm.toString())
    }
  }
  let imagesRecompressed = 0
  for (let i = 0; i < entries.length; i++) {
    const [ref, obj] = entries[i]
    if (i % 25 === 0) onProgress(0.05 + 0.85 * (i / entries.length), msg('prog.optimising'))
    if (!(obj instanceof PDFRawStream)) continue
    const dict = obj.dict
    if (dict.get(N('Subtype')) === N('Image')) {
      if (codec && !softMasks.has(ref.toString()) && (await recompressImage(ctx, ref, obj, codec, cfg))) imagesRecompressed++
    } else {
      deflateIfUncompressed(ctx, ref, obj)
    }
  }

  onProgress(0.93, msg('prog.saving'))
  const bytes = await saveDoc(doc)
  onProgress(1)
  if (bytes.length >= input.bytes.length) {
    return { bytes: input.bytes, originalSize: input.bytes.length, unchanged: true, imagesRecompressed: 0 }
  }
  return { bytes, originalSize: input.bytes.length, unchanged: false, imagesRecompressed }
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

function deflateIfUncompressed(ctx: PDFContext, ref: PDFRef, stream: PDFRawStream) {
  const dict = stream.dict
  const filters = filterNames(dict)
  if (!filters || filters.length) return
  // XMP metadata is conventionally left readable; tiny streams don't benefit.
  if (dict.get(N('Type')) === N('Metadata') || stream.contents.length < 256) return
  const deflated = pako.deflate(stream.contents)
  if (deflated.length >= stream.contents.length * MIN_GAIN) return
  dict.set(N('Filter'), N('FlateDecode'))
  ctx.assign(ref, PDFRawStream.of(dict, deflated))
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
): Promise<boolean> {
  const dict = stream.dict
  if (stream.contents.length < MIN_IMAGE_BYTES) return false
  // Masks, colour-key masks and decode arrays don't survive lossy re-encoding faithfully. Images with a
  // soft mask (transparency) are left alone so the mask and the image can never get out of step.
  if (dict.lookup(N('ImageMask')) || dict.lookup(N('Mask')) || dict.lookup(N('SMask')) || dict.lookup(N('SMaskInData')) || dict.lookup(N('Decode'))) return false
  if (num(dict, 'BitsPerComponent') !== 8) return false
  const width = num(dict, 'Width')
  const height = num(dict, 'Height')
  if (!width || !height || width * height > 100_000_000) return false
  const comp = components(ctx, dict)
  if (!comp) return false
  const filters = filterNames(dict)
  if (!filters) return false

  let encoded: EncodedImage | null = null
  try {
    if (filters.length && filters[filters.length - 1] === 'DCTDecode' && filters.slice(0, -1).every((f) => TRANSPORT_FILTERS.has(f))) {
      const jpeg = filters.length === 1 ? stream.contents : stripTransportFilters(stream, filters.slice(0, -1))
      const needsResize = Math.max(width, height) > cfg.maxDim
      encoded = await codec.recompressJpeg(jpeg, needsResize ? cfg.maxDim : Math.max(width, height), cfg.quality)
    } else if (cfg.convertLossless && filters.length === 1 && filters[0] === 'FlateDecode') {
      const raw = decodeFlateImage(stream, width, height, comp.n)
      if (!raw) return false
      encoded = await codec.encodeRaw(raw, width, height, comp.n, cfg.maxDim, cfg.quality)
    } else {
      return false
    }
  } catch {
    return false // undecodable image: leave it exactly as it was
  }
  if (!encoded || encoded.bytes.length >= stream.contents.length * MIN_GAIN) return false

  dict.set(N('Filter'), N('DCTDecode'))
  dict.delete(N('DecodeParms'))
  dict.set(N('Width'), PDFNumber.of(encoded.width))
  dict.set(N('Height'), PDFNumber.of(encoded.height))
  dict.set(N('BitsPerComponent'), PDFNumber.of(8))
  if (!comp.keepColorSpace) dict.set(N('ColorSpace'), N('DeviceRGB'))
  ctx.assign(ref, PDFRawStream.of(dict, encoded.bytes))
  return true
}

/** Encodings that wrap a JPEG without changing it (e.g. ReportLab's [/ASCII85Decode /DCTDecode]). */
const TRANSPORT_FILTERS = new Set(['ASCII85Decode', 'ASCIIHexDecode', 'FlateDecode', 'LZWDecode', 'RunLengthDecode'])

function stripTransportFilters(stream: PDFRawStream, filters: string[]): Uint8Array {
  const dict = PDFDict.withContext(stream.dict.context)
  dict.set(N('Filter'), filters.length === 1 ? N(filters[0]) : stream.dict.context.obj(filters.map((f) => N(f))))
  return decodePDFRawStream(PDFRawStream.of(dict, stream.contents)).decode()
}

/** Inflate an 8-bit image stream, undoing PNG predictors (10–15). Returns null for unsupported encodings. */
export function decodeFlateImage(stream: PDFRawStream, width: number, height: number, comps: number): Uint8Array | null {
  const parms = stream.dict.lookup(N('DecodeParms'))
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
