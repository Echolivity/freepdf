import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { scanPdfMarkers } from '../../src/lib/inspect'
import { extractPages, organizePdf, splitPdf } from '../../src/lib/pdf/organize'
import { compressPdf } from '../../src/lib/pdf/compress'
import { fixture, numberedPdf, qpdfCheck } from './helpers'
import { nodeCodec } from './node-codec'
import { meanDiff, renderPage } from './render'

const blob = (b: Uint8Array) => new Blob([b as BlobPart])

describe('signature / encryption detection', () => {
  it('distinguishes signed, certified, an empty signature field, and plain', async () => {
    expect(await scanPdfMarkers(blob(fixture('signed.pdf')))).toEqual({ signed: true, certified: false, encrypted: false })
    expect(await scanPdfMarkers(blob(fixture('certified.pdf')))).toEqual({ signed: true, certified: true, encrypted: false })
    expect(await scanPdfMarkers(blob(fixture('sig-field.pdf')))).toEqual({ signed: false, certified: false, encrypted: false })
    expect(await scanPdfMarkers(blob(fixture('rich.pdf')))).toEqual({ signed: false, certified: false, encrypted: false })
  })

  it('is not fooled by the keywords appearing as page text', async () => {
    // An uncompressed content stream that shows the keywords as visible text.
    const raw = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Length 60 >>\nstream\nBT (/ByteRange /Encrypt /DocMDP) Tj ET\nendstream\nendobj\n')
    expect(await scanPdfMarkers(blob(raw))).toEqual({ signed: false, certified: false, encrypted: false })
  })

  it('detects encryption declared in a classic trailer and in a cross-reference stream', async () => {
    expect((await scanPdfMarkers(blob(fixture('encrypted-user.pdf')))).encrypted).toBe(true)
    expect((await scanPdfMarkers(blob(fixture('encrypted-owner.pdf')))).encrypted).toBe(true)
    const xrefStream = new TextEncoder().encode('<< /Type /XRef /Size 9 /Root 1 0 R /Encrypt 8 0 R /W [1 2 1] >>')
    expect((await scanPdfMarkers(blob(xrefStream))).encrypted).toBe(true)
  })

  it('finds markers that straddle a 4 MB chunk boundary', async () => {
    const pad = new Uint8Array(4 * 1024 * 1024 - 7).fill(32)
    const b = new Blob([pad as BlobPart, new TextEncoder().encode('/ByteRange [0 840 960 1200]')])
    expect((await scanPdfMarkers(b)).signed).toBe(true)
  })
})

describe('no unnecessary rewrites', () => {
  it('extracting every page in order returns the original bytes — a signature stays valid', async () => {
    const signed = fixture('signed.pdf')
    const doc = await PDFDocument.load(signed)
    const out = await extractPages({ name: 's.pdf', bytes: signed }, doc.getPageIndices())
    expect(Buffer.from(out).equals(Buffer.from(signed))).toBe(true)
  })
  it('organize with no change and a one-part split of the whole document are no-ops', async () => {
    const src = await numberedPdf(4)
    expect(Buffer.from(await organizePdf({ name: 'a', bytes: src }, [0, 1, 2, 3].map((index) => ({ index })))).equals(Buffer.from(src))).toBe(true)
    const [only] = await splitPdf({ name: 'a', bytes: src }, [[0, 1, 2, 3]])
    expect(Buffer.from(only).equals(Buffer.from(src))).toBe(true)
  })
  it('any real change is still applied', async () => {
    const src = await numberedPdf(3)
    expect((await PDFDocument.load(await organizePdf({ name: 'a', bytes: src }, [{ index: 0, rotate: 90 }, { index: 1 }, { index: 2 }]))).getPage(0).getRotation().angle).toBe(90)
  })
})

describe('Lossless compression level', () => {
  it('never changes image pixels, even on a photo-heavy file', async () => {
    const original = fixture('compress/photos.pdf')
    const r = await compressPdf({ name: 'p.pdf', bytes: original }, 'lossless', nodeCodec)
    expect(r.report.recompressed).toBe(0)
    expect(r.report.skipped.losslessMode).toBe(r.report.images)
    const out = r.unchanged ? original : r.bytes
    for (const p of [1, 2, 3]) expect(meanDiff(await renderPage(original, p, 0.4), await renderPage(out, p, 0.4))).toBe(0)
    expect(out.length).toBeLessThanOrEqual(original.length)
  }, 120_000)

  it('still shrinks files with uncompressed data, and the result is valid', async () => {
    const base = await PDFDocument.load(await numberedPdf(3))
    const page = base.getPage(0)
    page.drawText('x '.repeat(4000), { x: 5, y: 5, size: 4 })
    const bytes = await base.save({ useObjectStreams: false })
    const r = await compressPdf({ name: 'u.pdf', bytes }, 'lossless', null)
    expect(r.unchanged).toBe(false)
    expect(r.bytes.length).toBeLessThan(bytes.length)
    qpdfCheck(r.bytes)
    expect(meanDiff(await renderPage(bytes, 1, 0.5), await renderPage(r.bytes, 1, 0.5))).toBe(0)
  })
})
