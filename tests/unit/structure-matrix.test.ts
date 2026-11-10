import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, PDFHexString, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { compressPdf } from '../../src/lib/pdf/compress'
import { extractPages, mergePdfs, organizePdf, removePages, rotatePdf, splitPdf } from '../../src/lib/pdf/organize'
import { scanPdfMarkers } from '../../src/lib/inspect'
import { fixture, qpdfCheck } from './helpers'
import { nodeCodec } from './node-codec'
import { meanDiff, renderPage } from './render'

/**
 * rich.pdf: 4 pages of mixed sizes (A4, A4 landscape, Letter, A5), page 2 rotated 90°, external URI link
 * and internal link to page 3 on page 1, sticky-note annotation on page 3, an embedded file, Arabic
 * title/author, bookmarks "Chapter 1–4", and a filled form field on page 1.
 */
const rich = () => ({ name: 'rich.pdf', bytes: fixture('rich.pdf') })
const N = PDFName.of
const text = (o: unknown) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : undefined)

async function describePdf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes)
  const pages = doc.getPages()
  const annots = pages.map((p) => {
    const a = p.node.lookup(N('Annots'))
    return a instanceof PDFArray
      ? a.asArray().map((r) => {
          const d = doc.context.lookup(r) as PDFDict
          const action = d.lookup(N('A'))
          return { type: String(d.get(N('Subtype'))).slice(1), uri: action instanceof PDFDict ? text(action.lookup(N('URI'))) : undefined }
        })
      : []
  })
  const outlines: string[] = []
  const root = doc.catalog.lookupMaybe(N('Outlines'), PDFDict)
  let it = root?.lookupMaybe(N('First'), PDFDict)
  while (it) { outlines.push(text(it.lookup(N('Title')))!); it = it.lookupMaybe(N('Next'), PDFDict) }
  const names = doc.catalog.lookupMaybe(N('Names'), PDFDict)
  const ef = names?.lookupMaybe(N('EmbeddedFiles'), PDFDict)?.lookupMaybe(N('Names'), PDFArray)
  let attachment: string | undefined
  if (ef) {
    const spec = ef.lookup(1, PDFDict)
    const stream = spec.lookup(N('EF'), PDFDict).lookup(N('F')) as PDFRawStream
    attachment = new TextDecoder().decode(decodePDFRawStream(stream).decode())
  }
  return {
    doc,
    sizes: pages.map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]),
    rotations: pages.map((p) => p.getRotation().angle),
    annots,
    outlines,
    attachment,
    title: doc.getTitle(),
    author: doc.getAuthor(),
    fields: doc.getForm().getFields().map((f) => f.getName()),
  }
}

describe('structure fixture sanity', () => {
  it('rich.pdf has everything the tests rely on', async () => {
    const d = await describePdf(fixture('rich.pdf'))
    expect(d.sizes).toEqual([[595, 842], [842, 595], [612, 792], [420, 595]])
    expect(d.rotations).toEqual([0, 90, 0, 0])
    expect(d.annots[0].map((a) => a.type).sort()).toEqual(['Link', 'Link', 'Widget'])
    expect(d.annots[0].some((a) => a.uri === 'https://example.org/')).toBe(true)
    expect(d.annots[2].map((a) => a.type)).toContain('Text')
    expect(d.outlines).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4'])
    expect(d.attachment).toContain('Attached notes')
    expect(d.title).toBe('تقرير سنوي — Annual report')
    expect(d.author).toBe('محمد عبدالله')
  })
})

describe('in-place tools keep document structure', () => {
  it('remove pages: sizes, rotation, annotations, external link, attachment and Arabic metadata survive', async () => {
    const out = await removePages(rich(), [2]) // drop page 3 (the internal link target)
    const d = await describePdf(out)
    expect(d.sizes).toEqual([[595, 842], [842, 595], [420, 595]])
    expect(d.rotations).toEqual([0, 90, 0])
    const p1 = d.annots[0].map((a) => a.type)
    expect(p1).toContain('Widget')
    expect(d.annots[0].filter((a) => a.type === 'Link')).toEqual([{ type: 'Link', uri: 'https://example.org/' }]) // internal link to removed page pruned, external kept
    expect(d.outlines).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 4'])
    expect(d.attachment).toContain('Attached notes')
    expect([d.title, d.author]).toEqual(['تقرير سنوي — Annual report', 'محمد عبدالله'])
    expect(d.fields).toEqual(['applicant'])
    qpdfCheck(out)
  })

  it('extract: annotation on the extracted page comes along', async () => {
    const d = await describePdf(await extractPages(rich(), [2]))
    expect(d.annots[0].map((a) => a.type)).toContain('Text')
    expect(d.sizes).toEqual([[612, 792]])
    expect(d.title).toBe('تقرير سنوي — Annual report')
  })

  it('organize: reordering keeps rotation, links and pixels', async () => {
    const out = await organizePdf(rich(), [{ index: 1 }, { index: 0 }, { index: 3 }, { index: 2 }])
    const d = await describePdf(out)
    expect(d.rotations).toEqual([90, 0, 0, 0])
    expect(d.annots[1].filter((a) => a.type === 'Link')).toHaveLength(2)
    expect(meanDiff(await renderPage(out, 1, 0.5), await renderPage(fixture('rich.pdf'), 2, 0.5))).toBe(0)
    qpdfCheck(out)
  })

  it('rotate: adds to existing rotation, everything else unchanged', async () => {
    const d = await describePdf(await rotatePdf(rich(), 90))
    expect(d.rotations).toEqual([90, 180, 90, 90])
    expect(d.attachment).toContain('Attached notes')
    expect(d.outlines).toHaveLength(4)
  })

  it('compress: structure untouched', async () => {
    const r = await compressPdf(rich(), 'strong', nodeCodec)
    const d = await describePdf(r.bytes)
    expect(d.sizes).toHaveLength(4)
    expect(d.outlines).toHaveLength(4)
    expect(d.attachment).toContain('Attached notes')
    expect(d.title).toBe('تقرير سنوي — Annual report')
  })

  it('split into few parts keeps per-part structure', async () => {
    const [a] = await splitPdf(rich(), [[0, 2], [1, 3]])
    const d = await describePdf(a)
    expect(d.annots[0].filter((x) => x.type === 'Link')).toHaveLength(2) // page 3 travelled with page 1
    expect(d.outlines).toEqual(['Chapter 1', 'Chapter 3'])
  })
})

describe('merge (documented limits)', () => {
  it('keeps page content, sizes, rotations, annotations, links and the first file’s Arabic metadata', async () => {
    const out = await mergePdfs([rich(), { name: 'b.pdf', bytes: fixture('text-8p.pdf') }])
    const d = await describePdf(out)
    expect(d.sizes.slice(0, 4)).toEqual([[595, 842], [842, 595], [612, 792], [420, 595]])
    expect(d.rotations.slice(0, 4)).toEqual([0, 90, 0, 0])
    expect(d.annots[0].some((a) => a.uri === 'https://example.org/')).toBe(true)
    expect(d.annots[2].map((a) => a.type)).toContain('Text')
    expect([d.title, d.author]).toEqual(['تقرير سنوي — Annual report', 'محمد عبدالله'])
    // Documented limitation: bookmarks, form fields and attachments are not merged.
    expect(d.outlines).toEqual([])
    expect(d.attachment).toBeUndefined()
    qpdfCheck(out)
  })
})

describe('signatures and protection are detected before processing', () => {
  const blob = (name: string) => new Blob([fixture(name) as BlobPart])
  it('flags a digitally signed PDF', async () => {
    expect(await scanPdfMarkers(blob('signed.pdf'))).toEqual({ signed: true, certified: false, encrypted: false })
    expect(await scanPdfMarkers(blob('rich.pdf'))).toEqual({ signed: false, certified: false, encrypted: false })
  })
  it('flags password- and permission-protected PDFs', async () => {
    expect((await scanPdfMarkers(blob('encrypted-user.pdf'))).encrypted).toBe(true)
    expect((await scanPdfMarkers(blob('encrypted-owner.pdf'))).encrypted).toBe(true)
    expect((await scanPdfMarkers(blob('text-8p.pdf'))).encrypted).toBe(false)
  })
  it('finds markers that straddle the 4 MB chunk boundary', async () => {
    const pad = new Uint8Array(4 * 1024 * 1024 - 4).fill(32)
    const b = new Blob([pad as BlobPart, new TextEncoder().encode('/ByteRange [0 1 2 3]')])
    expect((await scanPdfMarkers(b)).signed).toBe(true)
  })
  it('any rewrite of a signed PDF changes the signed byte range — hence the warning', async () => {
    const original = fixture('signed.pdf')
    const out = await rotatePdf({ name: 's.pdf', bytes: original }, 90)
    // The signed bytes are no longer the file's bytes: a validator will report the signature as invalid.
    expect(Buffer.from(out).equals(Buffer.from(original))).toBe(false)
  })
})
