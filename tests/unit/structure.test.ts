import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFString, PDFHexString } from 'pdf-lib'
import { extractPages, organizePdf, removePages, splitPdf } from '../../src/lib/pdf/organize'
import { fixture, numberedPdf, qpdfCheck } from './helpers'

/** structured.pdf: 4 pages; page N has text field field_pN, bookmark "Section N"; page 1 links to section 4. */
const src = () => ({ name: 'structured.pdf', bytes: fixture('structured.pdf') })

async function inspect(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes)
  const form = doc.getForm()
  const fields = form.getFields().map((f) => f.getName())
  const values = Object.fromEntries(fields.map((n) => [n, form.getTextField(n).getText()]))
  const titles: string[] = []
  const root = doc.catalog.lookup(PDFName.of('Outlines'), PDFDict)
  let item = root.lookupMaybe(PDFName.of('First'), PDFDict)
  while (item) {
    const t = item.lookup(PDFName.of('Title'))
    titles.push((t as PDFString | PDFHexString).decodeText())
    item = item.lookupMaybe(PDFName.of('Next'), PDFDict)
  }
  const count = (root.lookup(PDFName.of('Count')) as PDFNumber | undefined)?.asNumber() ?? 0
  const links = doc.getPages().map((p) => {
    const a = p.node.lookup(PDFName.of('Annots'))
    return a instanceof PDFArray ? a.asArray().filter((x) => (doc.context.lookup(x) as PDFDict).get(PDFName.of('Subtype')) === PDFName.of('Link')).length : 0
  })
  // every widget of every remaining field must sit on a page that is still in the document
  const pageRefs = new Set(doc.getPages().map((p) => p.ref.toString()))
  const orphanWidgets = form.getFields().flatMap((f) => f.acroField.getWidgets()).filter((w) => {
    const p = w.P()
    return p && !pageRefs.has(p.toString())
  }).length
  return { doc, fields, values, titles, count, links, orphanWidgets, title: doc.getTitle() }
}

describe('document structure is preserved and kept consistent', () => {
  it('fixture sanity', async () => {
    const s = await inspect(fixture('structured.pdf'))
    expect(s.fields).toEqual(['field_p1', 'field_p2', 'field_p3', 'field_p4'])
    expect(s.titles).toEqual(['Section 1', 'Section 2', 'Section 3', 'Section 4'])
    expect(s.links[0]).toBe(1)
  })

  it('remove pages: drops only the removed page’s field, bookmark and links to it', async () => {
    const out = await removePages(src(), [3])
    const s = await inspect(out)
    expect(s.fields).toEqual(['field_p1', 'field_p2', 'field_p3'])
    expect(s.values.field_p2).toBe('value 2')
    expect(s.titles).toEqual(['Section 1', 'Section 2', 'Section 3'])
    expect(s.count).toBe(3)
    expect(s.links[0]).toBe(0) // the link to removed section 4 is gone
    expect(s.orphanWidgets).toBe(0)
    expect(s.title).toBe('Structured fixture')
    qpdfCheck(out)
  })

  it('extract pages: keeps fields and bookmarks of the extracted pages', async () => {
    const out = await extractPages(src(), [1, 2])
    const s = await inspect(out)
    expect(s.doc.getPageCount()).toBe(2)
    expect(s.fields).toEqual(['field_p2', 'field_p3'])
    expect(s.titles).toEqual(['Section 2', 'Section 3'])
    expect(s.orphanWidgets).toBe(0)
    qpdfCheck(out)
  })

  it('organize: reordering keeps every field, bookmark and internal link', async () => {
    const out = await organizePdf(src(), [{ index: 3 }, { index: 0, rotate: 90 }, { index: 1 }, { index: 2 }])
    const s = await inspect(out)
    expect(s.fields).toHaveLength(4)
    expect(s.titles).toHaveLength(4)
    expect(s.links[1]).toBe(1) // old page 1 (now 2nd) still links to section 4
    expect(s.doc.getPage(1).getRotation().angle).toBe(90)
    qpdfCheck(out)
  })

  it('split (few parts): each part keeps its own fields and bookmarks', async () => {
    const [a, b] = await splitPdf(src(), [[0, 3], [1, 2]])
    const sa = await inspect(a)
    expect(sa.fields).toEqual(['field_p1', 'field_p4'])
    expect(sa.links[0]).toBe(1) // section 4 travelled with page 1
    const sb = await inspect(b)
    expect(sb.titles).toEqual(['Section 2', 'Section 3'])
    qpdfCheck(a)
    qpdfCheck(b)
  })

  it('removed pages are actually dropped from the file (not just hidden)', async () => {
    const big = await numberedPdf(300)
    const one = await extractPages({ name: 'b.pdf', bytes: big }, [0])
    expect(one.length).toBeLessThan(big.length / 20)
  })

  it('keeps inherited page attributes when flattening the page tree', async () => {
    // pdf-lib output puts MediaBox on each page; build a doc with MediaBox only on the root Pages node.
    const doc = await PDFDocument.create()
    doc.addPage([400, 500])
    doc.addPage([400, 500])
    const root = doc.catalog.lookup(PDFName.of('Pages'), PDFDict)
    root.set(PDFName.of('MediaBox'), doc.context.obj([0, 0, 400, 500]))
    doc.getPages().forEach((p) => p.node.delete(PDFName.of('MediaBox')))
    const out = await removePages({ name: 'i.pdf', bytes: await doc.save() }, [0])
    const page = (await PDFDocument.load(out)).getPage(0)
    expect(page.getSize()).toEqual({ width: 400, height: 500 })
  })
})
