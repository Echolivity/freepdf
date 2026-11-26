import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, StandardFonts, decodePDFRawStream, degrees } from 'pdf-lib'
import { setFontLoader } from '../../src/lib/pdf/fonts'
import { redact } from '../../src/lib/pdf/redact'
import { findOnPage, findRanges, keptWords, readSpans, charBox, type Box } from '../../src/lib/redact/find'
import { openNode, pageTexts } from './render'
import { qpdfCheck } from './helpers'

const fontDir = join(process.cwd(), 'node_modules', '@expo-google-fonts', 'ibm-plex-sans-arabic')
beforeAll(() => {
  setFontLoader(async (f) => new Uint8Array(readFileSync(join(fontDir, f.includes('Bold') ? '700Bold/IBMPlexSansArabic_700Bold.ttf' : '400Regular/IBMPlexSansArabic_400Regular.ttf'))))
})

/** Everything the file carries, as text: every object, with streams decompressed. */
async function everything(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const parts: string[] = [Buffer.from(bytes).toString('latin1')]
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try { parts.push(Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1')) } catch { /* image data */ }
      parts.push(obj.dict.toString())
    } else parts.push(obj.toString())
  }
  return parts.join('\n')
}

/** A two-page document with secrets in its text, metadata, bookmarks, form field and structure tree. */
async function secretPdf(rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.setTitle('Top SECRET plan')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const p1 = doc.addPage([612, 792])
  p1.setRotation(degrees(rotate))
  p1.drawText('Public intro line', { x: 72, y: 700, size: 14, font })
  p1.drawText('Account SECRET-4821 hidden', { x: 72, y: 600, size: 14, font })
  p1.drawText('Contact: jane.doe@example.com today', { x: 72, y: 500, size: 14, font })
  const p2 = doc.addPage([612, 792])
  p2.drawText('Second page text', { x: 72, y: 700, size: 14, font })
  const form = doc.getForm()
  const f1 = form.createTextField('on.first')
  f1.setText('SECRET field value')
  f1.addToPage(p1, { x: 72, y: 300, width: 200, height: 20 })
  const f2 = form.createTextField('on.second')
  f2.setText('keep me')
  f2.addToPage(p2, { x: 72, y: 300, width: 200, height: 20 })
  const ctx = doc.context
  const outline = ctx.register(ctx.obj({ Type: 'Outlines' }))
  const item = ctx.register(ctx.obj({ Title: PDFString.of('SECRET chapter'), Parent: outline, Dest: [p1.ref, PDFName.of('Fit')] }))
  ;(ctx.lookup(outline) as PDFDict).set(PDFName.of('First'), item)
  ;(ctx.lookup(outline) as PDFDict).set(PDFName.of('Last'), item)
  doc.catalog.set(PDFName.of('Outlines'), outline)
  doc.catalog.set(PDFName.of('StructTreeRoot'), ctx.register(ctx.obj({ Type: 'StructTreeRoot', K: ctx.obj({ S: 'P', Alt: PDFHexString.fromText('SECRET alt text') }) })))
  return doc.save()
}

function jpeg(w: number, h: number): Uint8Array {
  const c = createCanvas(Math.round(w), Math.round(h))
  const g = c.getContext('2d')
  g.fillStyle = '#fff'
  g.fillRect(0, 0, w, h)
  return new Uint8Array(c.toBuffer('image/jpeg'))
}

async function prepare(bytes: Uint8Array, terms: string[], patterns: ('email' | 'phone')[] = []) {
  const { doc, close } = await openNode(bytes)
  try {
    const p = await readSpans(doc as never, 0)
    const { boxes, matches } = findOnPage(p, patterns, terms)
    return { p, boxes, matches, words: keptWords(p, boxes, patterns, terms) }
  } finally { await close() }
}

describe('finding things to redact', () => {
  it('patterns: emails, phones, IBANs, cards, ID numbers, in Arabic digits too, not dates or amounts', () => {
    const t = (s: string, ids: Parameters<typeof findRanges>[1]) => findRanges(s, ids, []).map(([a, b]) => s.slice(a, b))
    expect(t('write to jane.doe@example.co.uk now', ['email'])).toEqual(['jane.doe@example.co.uk'])
    expect(t('call +966 50 123 4567 or 0501234567', ['phone'])).toEqual(['+966 50 123 4567', '0501234567'])
    expect(t('due 2026-11-26, total 1234.50, ref 12/05/2026', ['phone'])).toEqual([])
    expect(t('IBAN SA03 8000 0000 6080 1016 7519 ok', ['iban'])).toEqual(['SA03 8000 0000 6080 1016 7519'])
    expect(t('IBAN SA03 8000 0000 6080 1016 7518 bad checksum', ['iban'])).toEqual([])
    expect(t('card 4111 1111 1111 1111 and 4111 1111 1111 1112', ['card'])).toEqual(['4111 1111 1111 1111'])
    expect(t('ID 1012345678, Iqama 2123456789, not 3123456789', ['id'])).toEqual(['1012345678', '2123456789'])
    expect(t('رقم الهوية ١٠١٢٣٤٥٦٧٨ والجوال ٠٥٠١٢٣٤٥٦٧', ['id', 'phone']).sort()).toEqual(['٠٥٠١٢٣٤٥٦٧', '١٠١٢٣٤٥٦٧٨', '١٠١٢٣٤٥٦٧٨'].sort())
  })

  it('typed text is found case-insensitively; right-to-left runs map characters from the right', () => {
    expect(findRanges('The Secret and the SECRET', [], ['secret'])).toEqual([[4, 10], [19, 25]])
    const ltr = { str: 'abcd', x: 0, y: 100, dx: 1, dy: 0, size: 10, width: 40, rtl: false }
    const rtl = { ...ltr, rtl: true }
    expect(charBox(ltr, 0, 1, 0, 0).x).toBeCloseTo(0)
    expect(charBox(rtl, 0, 1, 0, 0).x).toBeCloseTo(30)
  })

  it('finds matches on a real page and keeps only words clear of the boxes', async () => {
    const { boxes, matches, words } = await prepare(await secretPdf(), ['SECRET-4821'], ['email'])
    expect(matches).toBe(2)
    expect(boxes).toHaveLength(2)
    const kept = words.map((w) => w.text)
    for (const w of ['Public', 'intro', 'Account', 'hidden', 'Contact:', 'today']) expect(kept).toContain(w)
    expect(kept).not.toContain('SECRET-4821')
    expect(kept.some((w) => w.includes('@'))).toBe(false)
  })
})

describe('redacting', () => {
  it('nothing redacted survives anywhere in the file; other pages and fields are kept', async () => {
    const bytes = await secretPdf()
    const { p, words } = await prepare(bytes, ['SECRET-4821'], ['email'])
    const r = await redact({ name: 's.pdf', bytes }, { pages: [{ index: 0, jpeg: jpeg(p.width, p.height), width: p.width, height: p.height, words }], sanitize: true })
    expect(r.pages).toBe(1)
    expect(r.fields).toBe(1)
    const all = await everything(r.bytes)
    expect(all).not.toMatch(/SECRET/i)
    expect(all).not.toContain('jane.doe')
    expect(qpdfCheck(r.bytes)).toBe(true)
    const texts = await pageTexts(r.bytes)
    expect(texts).toHaveLength(2)
    for (const s of ['Public intro line', 'hidden', 'today']) expect(texts[0]).toContain(s)
    expect(texts[1]).toContain('Second page text')
    const out = await PDFDocument.load(r.bytes)
    expect(out.getForm().getFields().map((f) => f.getName())).toEqual(['on.second'])
    expect(out.getForm().getTextField('on.second').getText()).toBe('keep me')
    expect(out.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size() ?? 0).toBe(0)
    expect(out.getPage(1).node.lookup(PDFName.of('Annots'), PDFArray).size()).toBe(1)
  })

  it('without removing hidden information, metadata and bookmarks stay (the page itself is still redacted)', async () => {
    const bytes = await secretPdf()
    const { p, words } = await prepare(bytes, ['SECRET-4821'])
    const r = await redact({ name: 's.pdf', bytes }, { pages: [{ index: 0, jpeg: jpeg(p.width, p.height), width: p.width, height: p.height, words }], sanitize: false })
    const out = await PDFDocument.load(r.bytes, { updateMetadata: false })
    expect(out.getTitle()).toBe('Top SECRET plan')
    expect(out.catalog.get(PDFName.of('Outlines'))).toBeDefined()
    // The structure tree always goes: it can hold the page's text.
    expect(out.catalog.get(PDFName.of('StructTreeRoot'))).toBeUndefined()
    expect((await pageTexts(r.bytes))[0]).not.toContain('SECRET-4821')
  })

  it('a picture used only on the redacted page goes, even when pages share their resources', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false })
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const p1 = doc.addPage([300, 300])
    const c = createCanvas(40, 40)
    c.getContext('2d').fillRect(0, 0, 40, 40)
    const png = await doc.embedPng(new Uint8Array(c.toBuffer('image/png')))
    p1.drawImage(png, { x: 10, y: 10, width: 40, height: 40 })
    p1.drawText('Page one', { x: 10, y: 200, size: 12, font })
    const p2 = doc.addPage([300, 300])
    p2.drawText('Page two', { x: 10, y: 200, size: 12, font })
    // One resource dictionary, inherited from the page tree by both pages (as some generators write it).
    const ctx = doc.context
    const res1 = p1.node.lookup(PDFName.of('Resources'), PDFDict)
    const res2 = p2.node.lookup(PDFName.of('Resources'), PDFDict)
    for (const [k, v] of res2.entries()) {
      const into = res1.lookupMaybe(k, PDFDict)
      const from = res2.lookupMaybe(k, PDFDict)
      if (into && from) for (const [n, r] of from.entries()) into.set(n, r)
      else if (!res1.get(k)) res1.set(k, v)
    }
    const shared = ctx.register(res1)
    p1.node.delete(PDFName.of('Resources'))
    p2.node.delete(PDFName.of('Resources'))
    doc.catalog.Pages().set(PDFName.of('Resources'), shared)
    const bytes = await doc.save()
    const images = async (b: Uint8Array) => {
      const d = await PDFDocument.load(b, { updateMetadata: false })
      return d.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')).length
    }
    expect(await images(bytes)).toBe(1)
    const r = await redact({ name: 's.pdf', bytes }, { pages: [{ index: 0, jpeg: jpeg(300, 300), width: 300, height: 300, words: [] }], sanitize: true })
    // Only the rebuilt page's own picture is left.
    expect(await images(r.bytes)).toBe(1)
    const out = await PDFDocument.load(r.bytes, { updateMetadata: false })
    const xo = out.getPage(0).node.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict)
    const img = out.context.lookup(xo.values()[0]) as PDFRawStream
    expect(img.dict.get(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'))
    expect((await pageTexts(r.bytes))[1]).toContain('Page two')
    expect(qpdfCheck(r.bytes)).toBe(true)
  })

  it('a rotated page is rebuilt upright at its displayed size, its text still where it was', async () => {
    const bytes = await secretPdf(90)
    const { p, words, boxes } = await prepare(bytes, ['SECRET-4821'])
    expect(p.width).toBeCloseTo(792)
    expect(p.height).toBeCloseTo(612)
    expect(boxes).toHaveLength(1)
    const r = await redact({ name: 's.pdf', bytes }, { pages: [{ index: 0, jpeg: jpeg(p.width, p.height), width: p.width, height: p.height, words }], sanitize: true })
    const out = await PDFDocument.load(r.bytes)
    expect(out.getPage(0).getRotation().angle).toBe(0)
    expect(out.getPage(0).getSize()).toEqual({ width: p.width, height: p.height })
    const { doc, close } = await openNode(r.bytes)
    try {
      const after = await readSpans(doc as never, 0)
      const pub = after.spans.find((s) => s.str.includes('Public'))!
      const before = p.spans.find((s) => s.str.includes('Public'))!
      // Same displayed position and direction as before redaction.
      expect(pub.x).toBeCloseTo(before.x, 0)
      expect(pub.y).toBeCloseTo(before.y, 0)
      expect(pub.dy).toBeCloseTo(before.dy, 2)
      const box: Box = boxes[0]
      expect(after.spans.some((s) => s.str.includes('SECRET'))).toBe(false)
      expect(box.page).toBe(0)
    } finally { await close() }
  })
})
