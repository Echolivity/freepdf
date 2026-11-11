import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib'
import { setFontLoader } from '../../src/lib/pdf/fonts'
import { looksLikeText, sniffKind, UserFacingError } from '../../src/lib/validate'
import { batchPages, batchRangeError } from '../../src/lib/ranges'
import { decodeTiff, tiffInfo } from '../../src/lib/convert/tiff'
import { cleanLine, decodeText, textToPdf, wrapLine, type TextToPdfOptions } from '../../src/lib/convert/textToPdf'
import { buildBlocks, buildLines, fixArabic, joinParagraph, type TextItem } from '../../src/lib/convert/pdfText'
import { readPageText, toFlowHtml, toLayoutHtml, toPlainText, hasText, type DocLike } from '../../src/lib/convert/pdfExport'
import { imagesToPdf } from '../../src/lib/pdf/images'
import { fixture, qpdfCheck } from './helpers'
import { openNode, pageTexts } from './render'

const fontDir = join(process.cwd(), 'node_modules/@expo-google-fonts/ibm-plex-sans-arabic')
beforeAll(() => {
  setFontLoader(async (f) => new Uint8Array(readFileSync(join(fontDir, f.includes('Bold') ? '700Bold/IBMPlexSansArabic_700Bold.ttf' : '400Regular/IBMPlexSansArabic_400Regular.ttf'))))
})

const conv = (name: string) => fixture(`convert/${name}`)
const errKey = async (p: Promise<unknown>) => {
  try { await p } catch (e) { return e instanceof UserFacingError ? e.key : `not user-facing: ${(e as Error).message}` }
  return 'no error'
}

describe('recognising TIFF and text input', () => {
  it('sniffs TIFF in both byte orders by content', () => {
    expect(sniffKind(conv('two-pages-lzw.tif').subarray(0, 64))).toBe('tiff')
    expect(sniffKind(new Uint8Array([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8]))).toBe('tiff')
    expect(sniffKind(new Uint8Array([0x49, 0x49, 0x2b, 0]))).toBeNull() // BigTIFF: not supported
  })
  it('accepts .txt only when the content is text', () => {
    expect(looksLikeText(conv('notes.txt'), 'notes.txt')).toBe(true)
    expect(looksLikeText(conv('utf16.txt'), 'utf16.txt')).toBe(true)
    expect(looksLikeText(conv('latin1.txt'), 'latin1.TXT')).toBe(true)
    expect(looksLikeText(conv('binary.txt'), 'binary.txt')).toBe(false)
    expect(looksLikeText(conv('notes.txt'), 'notes.pdf')).toBe(false)
  })
})

describe('page ranges for batches', () => {
  it('means every page when empty, and skips pages a shorter file lacks', () => {
    expect(batchPages('', 3)).toEqual([0, 1, 2])
    expect(batchPages('2-', 4)).toEqual([1, 2, 3])
    expect(batchPages('1, 5-9', 6)).toEqual([0, 4, 5])
    expect(batchPages('last', 7)).toEqual([6])
    expect(batchPages('٢-٣', 5)).toEqual([1, 2])
    expect(batchPages('10-12', 3)).toEqual([])
  })
  it('reports malformed ranges before anything runs', () => {
    expect(batchRangeError('')).toBeNull()
    expect(batchRangeError('1-3, 8-')).toBeNull()
    expect(batchRangeError('1-x')?.key).toBe('rng.invalid')
    expect(batchRangeError('0')?.key).toBe('rng.startAt1')
  })
})

describe('TIFF decoding', () => {
  const pages = async (name: string) => {
    const out: { w: number; h: number; dpi: number | null; alpha: boolean; compression: number; first: number[] }[] = []
    await decodeTiff(conv(name), name, async (p) => { out.push({ w: p.width, h: p.height, dpi: p.dpi, alpha: p.alpha, compression: p.compression, first: [...p.rgba.subarray(0, 4)] }) })
    return out
  }
  it('reads every page of a multi-page LZW TIFF with its resolution', async () => {
    expect(await pages('two-pages-lzw.tif')).toMatchObject([
      { w: 600, h: 400, dpi: 150, compression: 5 },
      { w: 400, h: 600, dpi: 150, compression: 5 },
    ])
    expect(await tiffInfo(conv('two-pages-lzw.tif'))).toEqual([{ width: 600, height: 400 }, { width: 400, height: 600 }])
  })
  it('decodes CCITT Group 4 fax, PackBits greyscale, JPEG-in-TIFF and Deflate with alpha', async () => {
    const [fax] = await pages('fax-g4.tif')
    expect(fax).toMatchObject({ w: 1700, h: 2200, dpi: 200, compression: 4, first: [255, 255, 255, 255] })
    expect((await pages('gray-packbits.tif'))[0]).toMatchObject({ w: 320, h: 240, compression: 32773 })
    expect((await pages('rgb-jpeg.tif'))[0]).toMatchObject({ w: 320, h: 240, compression: 7, alpha: false })
    const [rgba] = await pages('rgba-deflate.tif')
    expect(rgba).toMatchObject({ w: 240, h: 240, alpha: true })
  })
  it('fails a truncated or non-TIFF file with a clear message', async () => {
    expect(await errKey(pages('truncated.tif'))).toMatch(/^err\.tiff/)
    expect(await errKey(pages('notes.txt'))).toBe('err.tiffBrokenNamed')
  })
  it('lays a scan out at its physical size: 1 px at 200 dpi is 72/200 pt, so a 1700 px wide fax is 612 pt (Letter)', async () => {
    const pdf = await imagesToPdf([{ name: 'fax', kind: 'png', bytes: onePixelPng(), dpi: 200 }], { pageSize: 'fit', orientation: 'auto', margin: 0 })
    expect((await PDFDocument.load(pdf)).getPage(0).getWidth()).toBeCloseTo(72 / 200, 3)
    const at96 = await imagesToPdf([{ name: 'photo', kind: 'png', bytes: onePixelPng() }], { pageSize: 'fit', orientation: 'auto', margin: 0 })
    expect((await PDFDocument.load(at96)).getPage(0).getWidth()).toBeCloseTo(0.75, 3)
  })
})

function onePixelPng(): Uint8Array {
  return Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
}

describe('text decoding', () => {
  it('honours byte-order marks and detects UTF-8', () => {
    expect(decodeText(conv('utf16.txt'), 'auto')).toMatchObject({ encoding: 'UTF-16', guessed: false })
    expect(decodeText(conv('utf16.txt'), 'windows-1252').text).toContain('سطر عربي')
    expect(decodeText(conv('notes.txt'), 'auto')).toMatchObject({ encoding: 'UTF-8', guessed: false })
  })
  it('falls back to Windows-1252 for legacy files, and reads Windows-1256 when asked', () => {
    expect(decodeText(conv('latin1.txt'), 'auto')).toEqual({ text: 'Café crème — naïve résumé\n', encoding: 'Windows-1252', guessed: true })
    expect(decodeText(conv('arabic-1256.txt'), 'windows-1256').text).toBe('نص بترميز ويندوز 1256\n')
  })
  it('expands tabs to tab stops and drops control characters', () => {
    expect(cleanLine('a\tb')).toBe('a   b')
    expect(cleanLine('abcd\te')).toBe('abcd    e')
    expect(cleanLine('x\x1b[0my')).toBe('x[0my')
  })
  it('wraps at word boundaries and breaks words longer than a line', () => {
    const m = (s: string) => s.length // one unit per character
    expect(wrapLine('aaa bbb ccc', 7, m)).toEqual(['aaa bbb', 'ccc'])
    expect(wrapLine('abcdefghij', 4, m)).toEqual(['abcd', 'efgh', 'ij'])
    expect(wrapLine('   ', 5, m)).toEqual([''])
    expect(wrapLine('  indented text', 20, m)).toEqual(['  indented text'])
  })
})

const opts = (o: Partial<TextToPdfOptions> = {}): TextToPdfOptions => ({ pageSize: 'a4', orientation: 'portrait', margin: 54, font: 'helvetica', size: 11, encoding: 'auto', ...o })

describe('TXT to PDF', () => {
  it('lays out wrapped, mixed Arabic/English text with a form-feed page break', async () => {
    const r = await textToPdf({ name: 'notes.txt', bytes: conv('notes.txt') }, opts())
    expect(qpdfCheck(r.pdf)).toBe(true)
    expect(r).toMatchObject({ pages: 2, encoding: 'UTF-8', guessed: false, fontSwitched: true, missing: [] })
    const [p1, p2] = await pageTexts(r.pdf)
    expect(p1).toContain('Meeting notes')
    expect(p1).toContain('Indented with a tab.')
    expect(p1).toMatch(/مرحبا/)
    expect(p2).toContain('Second page after a form feed.')
    const doc = await PDFDocument.load(r.pdf)
    expect(doc.getTitle()).toBe('notes')
    expect(doc.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 })
  })
  it('right-aligns Arabic paragraphs and left-aligns English ones', async () => {
    const r = await textToPdf({ name: 'a.txt', bytes: new TextEncoder().encode('مرحبا بالعالم\nHello world\n') }, opts())
    const { doc, close } = await openNode(r.pdf)
    try {
      const page = await readPageText(doc as unknown as DocLike, 1)
      const [ar, en] = page.lines
      expect(ar.rtl).toBe(true)
      expect(ar.text).toBe('مرحبا بالعالم')
      expect(595.28 - 54 - ar.x1).toBeLessThan(2) // flush with the right margin
      expect(en.x0).toBeCloseTo(54, 0)
    } finally {
      await close()
    }
  })
  it('keeps Latin-only text in the chosen standard font', async () => {
    const r = await textToPdf({ name: 'latin1.txt', bytes: conv('latin1.txt') }, opts({ font: 'courier', encoding: 'windows-1252' }))
    expect(r).toMatchObject({ fontSwitched: false, encoding: 'Windows-1252', pages: 1 })
    expect((await pageTexts(r.pdf))[0]).toContain('Café crème — naïve résumé')
    const doc = await PDFDocument.load(r.pdf)
    const names = doc.context.enumerateIndirectObjects().map(([, o]) => String((o as { get?: (k: PDFName) => unknown }).get?.(PDFName.of('BaseFont')) ?? ''))
    expect(names).toContain('/Courier')
  })
  it('reports characters no font can show', async () => {
    const r = await textToPdf({ name: 'cjk.txt', bytes: new TextEncoder().encode('Hello 中文 مرحبا\n') }, opts())
    expect(r.missing).toEqual(expect.arrayContaining(['中', '文']))
    expect(r.missing).not.toContain('H')
  })
  it('starts a new page when a page fills up, and honours landscape Letter', async () => {
    const text = Array.from({ length: 120 }, (_, i) => `Line ${i + 1}`).join('\n')
    const r = await textToPdf({ name: 'long.txt', bytes: new TextEncoder().encode(text) }, opts({ pageSize: 'letter', orientation: 'landscape', size: 12 }))
    expect(r.pages).toBeGreaterThan(2)
    expect(qpdfCheck(r.pdf)).toBe(true)
    const all = (await pageTexts(r.pdf)).join(' ')
    expect(all).toContain('Line 1 ')
    expect(all).toContain('Line 120')
    expect((await PDFDocument.load(r.pdf)).getPage(0).getSize()).toEqual({ width: 792, height: 612 })
  })
})

const item = (str: string, x: number, y: number, width: number, size = 10): TextItem => ({ str, x, y, width, size, upright: true })

describe('rebuilding lines and paragraphs from positioned text', () => {
  it('turns presentation forms into letters and reverses visually stored Arabic', () => {
    expect(fixArabic('ﻣﺮﺣﺒﺎ')).toBe('مرحبا') // already in reading order
    expect(fixArabic('ﺎﺒﺣﺮﻣ')).toBe('مرحبا') // stored right-to-left
    expect(fixArabic('plain text')).toBe('plain text')
  })
  it('groups fragments by baseline and adds the spaces PDFs leave out', () => {
    const lines = buildLines([item('world', 60, 700, 25), item('Hello', 20, 700.4, 25), item('Next', 20, 686, 20)])
    expect(lines.map((l) => l.text)).toEqual(['Hello world', 'Next'])
  })
  it('does not add spaces between touching fragments, and marks wide gaps as column breaks', () => {
    expect(buildLines([item('Foo', 20, 700, 15), item('bar', 35, 700, 15)])[0].text).toBe('Foobar')
    expect(buildLines([item('Name', 20, 700, 20), item('Total', 200, 700, 25)])[0].text).toBe('Name\tTotal')
  })
  it('reads right-to-left lines from their right edge', () => {
    const [line] = buildLines([item('العالم', 20, 700, 30), item('مرحبا', 60, 700, 25)])
    expect(line).toMatchObject({ text: 'مرحبا العالم', rtl: true })
  })
  it('splits paragraphs at extra spacing, finds headings by size, undoes hyphenation', () => {
    const lines = buildLines([
      item('Title', 20, 760, 60, 20),
      item('A long infor-', 20, 720, 60),
      item('mation line.', 20, 708, 60),
      item('Second paragraph.', 20, 680, 80),
    ])
    const blocks = buildBlocks(lines, 10)
    expect(blocks.map((b) => [b.kind, b.text])).toEqual([
      ['h1', 'Title'],
      ['p', 'A long information line.'],
      ['p', 'Second paragraph.'],
    ])
    expect(joinParagraph(['well-', 'Known'])).toBe('well- Known')
  })
})

describe('PDF to TXT and HTML', () => {
  const read = async (bytes: Uint8Array) => {
    const { doc, close } = await openNode(bytes)
    try {
      const pages = []
      for (let i = 1; i <= doc.numPages; i++) pages.push(await readPageText(doc as unknown as DocLike, i))
      return pages
    } finally {
      await close()
    }
  }
  const labels = { document: 'Converted document', page: (n: number) => `Page ${n}` }

  it('round-trips a TXT → PDF conversion back to the same text', async () => {
    const src = 'First line of text\nSecond line\n\nNew paragraph after a gap\nمرحبا بالعالم'
    const r = await textToPdf({ name: 'rt.txt', bytes: new TextEncoder().encode(src) }, opts())
    const out = toPlainText(await read(r.pdf), { layout: 'lines', pageMarkers: false, lineEnding: 'lf' }, labels.page)
    expect(out).toBe(src + '\n')
  })
  it('extracts a browser-printed Arabic PDF in reading order, with plain letters and correct numbers', async () => {
    // arabic.pdf stores Arabic as presentation forms, one glyph per fragment, in visual order.
    const pages = await read(fixture('arabic.pdf'))
    const text = toPlainText(pages, { layout: 'paragraphs', pageMarkers: false, lineEnding: 'lf' }, labels.page)
    expect(text).toContain('الصفحة 1: عقد إيجار')
    expect(text).toContain('يتفق الطرفان على أن تكون مدة العقد اثني عشر شهرًا تبدأ من تاريخ ١٤٤٨/٠٥/٠١ هـ، وقيمة الإيجار السنوي 24,000 ريال سعودي.')
    expect(text).toContain('Contract reference: FP-2026-001 — مرجع العقد.')
    expect(text).toContain('الأولى 12,000 2026-11-10')
    expect(text).toContain('الطرف الثاني: شركة المثال المحدودة')
    expect(text).not.toMatch(/[\ufb50-\ufdff\ufe70-\ufeff]/) // no presentation forms left
  })
  it('adds page markers and Windows line endings when asked', async () => {
    const pages = await read(fixture('text-8p.pdf'))
    expect(hasText(pages)).toBe(true)
    const out = toPlainText(pages.slice(0, 2), { layout: 'paragraphs', pageMarkers: true, lineEnding: 'crlf' }, labels.page)
    expect(out.startsWith('Page 1\r\n\r\n')).toBe(true)
    expect(out).toContain('\r\n\r\n\r\nPage 2\r\n')
    expect(out.replace(/\r\n/g, '')).not.toContain('\n')
  })
  it('finds no text in a scan (pages that are only images)', async () => {
    const pdf = await imagesToPdf([{ name: 'p', kind: 'png', bytes: onePixelPng() }], { pageSize: 'a4', orientation: 'auto', margin: 0 })
    expect(hasText(await read(pdf))).toBe(false)
    expect(hasText(await read(fixture('scan.pdf')))).toBe(true) // that fixture has a small text label per page
  })
  it('escapes PDF text in HTML and locks the page down', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const page = doc.addPage([400, 300])
    page.drawText('Big heading', { x: 20, y: 250, size: 24, font })
    page.drawText('<script>alert(1)</script> & "quotes"', { x: 20, y: 200, size: 11, font })
    const pages = await read(await doc.save())
    for (const html of [toFlowHtml('A <title>', pages, labels), toLayoutHtml('A <title>', pages.map((p) => ({ ...p, image: 'data:image/jpeg;base64,AAAA' })), labels)]) {
      expect(html).not.toMatch(/<script/i)
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;')
      expect(html).toContain(`content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"`)
      expect(html).toContain('<title>A &lt;title&gt;</title>')
    }
    expect(toFlowHtml('t', pages, labels)).toContain('<h1>Big heading</h1>')
    const layout = toLayoutHtml('t', pages.map((p) => ({ ...p, image: 'data:image/jpeg;base64,AAAA' })), labels)
    expect(layout).toContain('viewBox="0 0 400 300"')
    expect(layout).toMatch(/<text x="20" y="50" font-size="24" textLength="[\d.]+" lengthAdjust="spacingAndGlyphs">Big heading<\/text>/)
  })
  it('marks an Arabic document right-to-left', async () => {
    const r = await textToPdf({ name: 'ar.txt', bytes: new TextEncoder().encode('عنوان المستند\nفقرة عربية قصيرة') }, opts())
    const html = toFlowHtml('t', await read(r.pdf), labels)
    expect(html).toContain('<html lang="ar" dir="rtl">')
    expect(html).toContain('عنوان المستند')
  })
})
