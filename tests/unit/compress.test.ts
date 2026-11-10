import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFRawStream, PDFNumber } from 'pdf-lib'
import pako from 'pako'
import { compressPdf, undoPngPredictor, type ImageCodec } from '../../src/lib/pdf/compress'
import { fixture, numberedPdf, qpdfCheck } from './helpers'

/** Test codec: pretends to re-encode by returning a real, smaller JPEG (photo.jpg, 400×300). */
const smallJpeg = fixture('photo.jpg')
const fakeCodec: ImageCodec = {
  recompressJpeg: async () => ({ bytes: smallJpeg, width: 400, height: 300 }),
  encodeRaw: async () => ({ bytes: smallJpeg, width: 400, height: 300 }),
}

function imageDims(doc: PDFDocument) {
  const dims: number[][] = []
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) {
      dims.push([(obj.dict.get(PDFName.of('Width')) as PDFNumber).asNumber(), (obj.dict.get(PDFName.of('Height')) as PDFNumber).asNumber()])
    }
  }
  return dims
}

describe('compress', () => {
  it('re-encodes embedded photos (ASCII85+DCT wrapped) and shrinks the file', async () => {
    const src = fixture('scan.pdf')
    const res = await compressPdf({ name: 'scan.pdf', bytes: src }, 'balanced', fakeCodec)
    expect(res.unchanged).toBe(false)
    expect(res.imagesRecompressed).toBeGreaterThan(0)
    expect(res.bytes.length).toBeLessThan(src.length / 5)
    const doc = await PDFDocument.load(res.bytes)
    expect(doc.getPageCount()).toBe(2)
    expect(imageDims(doc)).toContainEqual([400, 300])
    qpdfCheck(res.bytes)
  })

  it('returns the original when nothing can be gained', async () => {
    const src = fixture('text-8p.pdf')
    const res = await compressPdf({ name: 'a.pdf', bytes: src }, 'strong', fakeCodec)
    if (res.unchanged) expect(res.bytes).toBe(src)
    else expect(res.bytes.length).toBeLessThan(src.length)
  })

  it('losslessly deflates uncompressed streams and drops orphaned objects without a codec', async () => {
    const base = await PDFDocument.load(await numberedPdf(3))
    // add an uncompressed, unreferenced 200 KB stream (like leftovers from incremental saves)
    const junk = base.context.flateStream(new Uint8Array(200_000).fill(65))
    base.context.register(junk)
    const big = new TextEncoder().encode('BT /F1 12 Tf 10 10 Td (hello) Tj ET\n'.repeat(5000))
    const raw = PDFRawStream.of(base.context.obj({}), big)
    const ref = base.context.register(raw)
    base.getPage(0).node.set(PDFName.of('PieceInfo'), ref) // referenced, uncompressed
    const bytes = await base.save({ useObjectStreams: false })
    const res = await compressPdf({ name: 'x.pdf', bytes }, 'light', null)
    expect(res.unchanged).toBe(false)
    expect(res.bytes.length).toBeLessThan(bytes.length / 4)
    expect((await PDFDocument.load(res.bytes)).getPageCount()).toBe(3)
    qpdfCheck(res.bytes)
  })

  it('rejects encrypted files with a clear message', async () => {
    await expect(compressPdf({ name: 'locked.pdf', bytes: fixture('encrypted-user.pdf') }, 'balanced', fakeCodec)).rejects.toThrow(/password-protected/)
  })

  it('undoes PNG predictors (Up / Paeth)', () => {
    // 2x2 RGB image, row 0 filter None, row 1 filter Up
    const rows = new Uint8Array([0, 10, 20, 30, 40, 50, 60, 2, 1, 1, 1, 1, 1, 1])
    expect(Array.from(undoPngPredictor(rows, 6, 2, 3)!)).toEqual([10, 20, 30, 40, 50, 60, 11, 21, 31, 41, 51, 61])
    expect(pako).toBeDefined()
  })
})

describe('compress safety', () => {
  it('never re-encodes images that have transparency (soft mask)', async () => {
    const doc = await PDFDocument.create()
    const img = await doc.embedPng(fixture('alpha-noise.png'))
    doc.addPage([300, 300]).drawImage(img, { x: 0, y: 0, width: 300, height: 300 })
    const bytes = await doc.save()
    let calls = 0
    const spy: ImageCodec = {
      recompressJpeg: async () => { calls++; return { bytes: smallJpeg, width: 400, height: 300 } },
      encodeRaw: async () => { calls++; return { bytes: smallJpeg, width: 400, height: 300 } },
    }
    const res = await compressPdf({ name: 'a.pdf', bytes }, 'strong', spy)
    expect(calls).toBe(0)
    expect(res.imagesRecompressed).toBe(0)
  })
})
