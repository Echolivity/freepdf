import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { cellRef, formatGeneral, formatNumber, serialToDate } from '../../src/lib/convert/xlsx'
import { evalContent, formatCounter } from '../../src/lib/convert/pseudo'
import { sanitizeCss } from '../../src/lib/convert/htmlInput'
import { paginate } from '../../src/lib/convert/domToPdf'
import { gridFromSpans, parseNumber } from '../../src/lib/convert/pdfTables'
import { buildDocx, buildPptx, buildXlsx, sheetName, xmlText } from '../../src/lib/convert/ooxml'
import { buildBlocks, buildLines, fixArabic, type TextItem } from '../../src/lib/convert/pdfText'
import { sniffByName, isLegacyOffice } from '../../src/lib/validate'
import type { Span } from '../../src/lib/convert/pdfExport'

describe('Excel number formats', () => {
  it('formats numbers like Excel', () => {
    expect(formatNumber(1234.5, '#,##0.00')).toBe('1,234.50')
    expect(formatNumber(0.0716826, '0.0%')).toBe('7.2%')
    expect(formatNumber(-1234, '#,##0;(#,##0)')).toBe('(1,234)')
    expect(formatNumber(1234567, '#,##0,"K"')).toBe('1,235K')
    expect(formatNumber(5, '0000')).toBe('0005')
    expect(formatNumber(0.5, '0.00')).toBe('0.50')
    expect(formatNumber(12.5, '[$€-407] #,##0.00')).toBe('€ 12.50')
    expect(formatNumber(1500, '#,##0.00 "SAR"')).toBe('1,500.00 SAR')
    expect(formatNumber(123456, '0.00E+00')).toBe('1.23E+05')
    expect(formatNumber(-3, 'General')).toBe('-3')
  })
  it('formats dates and times from serial numbers (1900 and 1904 systems)', () => {
    expect(formatNumber(46037, 'yyyy-mm-dd')).toBe('2026-01-15')
    expect(formatNumber(46037, 'm/d/yyyy')).toBe('1/15/2026')
    expect(formatNumber(46037, 'd mmmm yyyy')).toBe('15 January 2026')
    expect(formatNumber(46037.75, 'h:mm AM/PM')).toBe('6:00 PM')
    expect(formatNumber(46037.5, 'hh:mm:ss')).toBe('12:00:00')
    expect(serialToDate(1).toISOString().slice(0, 10)).toBe('1900-01-01')
    expect(serialToDate(61).toISOString().slice(0, 10)).toBe('1900-03-01')
    expect(serialToDate(0, true).toISOString().slice(0, 10)).toBe('1904-01-01')
  })
  it('shows General numbers with up to 11 significant digits', () => {
    expect(formatGeneral(0.1 + 0.2)).toBe('0.3')
    expect(formatGeneral(1 / 3)).toBe('0.33333333333')
    expect(formatGeneral(42)).toBe('42')
  })
  it('reads cell references', () => {
    expect(cellRef('A1')).toEqual([0, 0])
    expect(cellRef('AB12')).toEqual([11, 27])
  })
})

describe('generated content and list markers', () => {
  it('evaluates counters and quoted text like Word numbering', () => {
    const counters = new Map([['docx-num-5-0', [3]], ['outer', [2]]])
    expect(evalContent('counter(docx-num-5-0, decimal) "." "\\9"', counters)).toBe('3.\t')
    expect(evalContent('"" counter(docx-num-5-0, lower-roman) ")"', counters)).toBe('iii)')
    expect(evalContent('"\\f0b7\\9"', counters)).toBe('•\t') // Symbol-font bullet
  })
  it('formats list counter styles', () => {
    expect(formatCounter(28, 'lower-alpha')).toBe('ab')
    expect(formatCounter(4, 'upper-roman')).toBe('IV')
    expect(formatCounter(12, 'arabic-indic')).toBe('١٢')
    expect(formatCounter(7, 'decimal-leading-zero')).toBe('07')
  })
})

describe('HTML input safety', () => {
  it('removes every external reference from CSS but keeps data: images', () => {
    const r = sanitizeCss('@import url(https://x.test/a.css); p{background:url(https://x.test/t.png)} q{background:url("data:image/png;base64,AAAA")} a{position:fixed;behavior:url(x.htc)}')
    expect(r.css).not.toMatch(/x\.test|@import|fixed|htc/)
    expect(r.css).toContain('data:image/png;base64,AAAA')
    expect(r.removed).toBe(4)
  })
  it('recognises Office and HTML files by name and content', () => {
    const zip = new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])
    expect(sniffByName(zip, 'a.docx')).toBe('docx')
    expect(sniffByName(zip, 'a.XLSX')).toBe('xlsx')
    expect(sniffByName(zip, 'a.zip')).toBeNull()
    expect(sniffByName(new TextEncoder().encode('<!DOCTYPE html><p>x'), 'page.htm')).toBe('html')
    expect(sniffByName(new TextEncoder().encode('just text'), 'page.html')).toBeNull()
    expect(isLegacyOffice(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe(true)
  })
})

describe('pagination', () => {
  it('cuts between lines, never through one', () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({ top: i * 30, bottom: i * 30 + 20 }))
    expect(paginate(lines, [], 100, 300)).toEqual([0, 90, 180, 270])
  })
  it('honours forced breaks and cuts an image taller than a page', () => {
    expect(paginate([{ top: 0, bottom: 20 }, { top: 40, bottom: 60 }], [30], 100, 60)).toEqual([0, 30])
    expect(paginate([{ top: 0, bottom: 250 }], [], 100, 250)).toEqual([0, 100, 200])
  })
})

const span = (str: string, x: number, y: number, width: number, size = 10): Span => ({ str, x, y, width, size, angle: 0 })

describe('tables from positioned text', () => {
  it('rebuilds rows and columns, with titles in the first column', () => {
    const g = gridFromSpans([
      span('Sales 2026', 100, 20, 60, 14),
      span('Region', 20, 50, 40), span('Amount', 150, 50, 45),
      span('North', 20, 65, 30), span('1,234.50', 150, 65, 45),
      span('South', 20, 80, 30), span('987.25', 160, 80, 35),
    ])
    expect(g.rows).toEqual([['Sales 2026', null], ['Region', 'Amount'], ['North', '1,234.50'], ['South', '987.25']])
    expect(g.rtl).toBe(false)
  })
  it('orders right-to-left tables from the right', () => {
    const g = gridFromSpans([span('القيمة', 20, 50, 30), span('البند', 150, 50, 30), span('24,000', 20, 65, 30), span('الإيجار', 150, 65, 30)])
    expect(g.rtl).toBe(true)
    expect(g.rows).toEqual([['البند', 'القيمة'], ['الإيجار', '24,000']])
  })
  it('turns numeric text into numbers with a matching format', () => {
    expect(parseNumber('1,234.50')).toEqual({ value: 1234.5, format: '#,##0.00' })
    expect(parseNumber('7.2%')).toEqual({ value: 0.072, format: '0.0%' })
    expect(parseNumber('(500)')).toEqual({ value: -500, format: '0;(0)' })
    expect(parseNumber('٢٤٬٠٠٠')).toEqual({ value: 24000, format: '#,##0' })
    expect(parseNumber('007')).toBeNull() // an identifier, not a number
    expect(parseNumber('2026-01-15')).toBeNull()
    expect(parseNumber('12 apples')).toBeNull()
  })
})

const item = (str: string, x: number, y: number, width: number, size = 10): TextItem => ({ str, x, y, width, size, upright: true })

describe('text clean-up for Office output', () => {
  it('repairs a swapped lam-alef and maps Symbol bullets', () => {
    expect(fixArabic('في الربع األول')).toBe('في الربع الأول')
    expect(fixArabic('اإليجار')).toBe('الإيجار')
    expect(fixArabic('الكتاب')).toBe('الكتاب') // a real alef-lam stays
    expect(fixArabic(' item')).toBe('• item')
  })
  it('keeps list items and table rows as separate blocks', () => {
    const lines = buildLines([item('• One', 20, 700, 30), item('• Two', 20, 688, 30), item('Name', 20, 676, 25), item('Total', 200, 676, 25), item('A', 20, 664, 8), item('1', 200, 664, 8)])
    expect(buildBlocks(lines, 10).map((b) => b.text)).toEqual(['• One', '• Two', 'Name Total', 'A 1'])
  })
})

describe('Office packages', () => {
  const parts = async (bytes: Uint8Array) => {
    const zip = await JSZip.loadAsync(bytes)
    return { zip, names: Object.keys(zip.files).sort(), text: (n: string) => zip.file(n)!.async('string') }
  }
  it('escapes text for XML and drops characters XML cannot hold', () => {
    expect(xmlText('a<b>&"c"\u0001\ud800')).toBe('a&lt;b&gt;&amp;&quot;c&quot;')
    expect(sheetName('Q1/Q2: [draft]?', new Set())).toBe('Q1 Q2   draft')
    const used = new Set(['page 1'])
    expect(sheetName('Page 1', used)).toBe('Page 1 2')
  })
  it('writes a Word document with headings, right-to-left paragraphs, a picture and a page break', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const bytes = await buildDocx(
      [
        { type: 'p', kind: 'h1', text: 'Title <1>', size: 20, rtl: false, align: 'start' },
        { type: 'p', kind: 'p', text: 'مرحبا\tبالعالم', size: 11, rtl: true, align: 'start' },
        { type: 'image', bytes: png, ext: 'png', width: 1000, height: 500 },
        { type: 'pageBreak' },
      ],
      { title: 'T', pageWidth: 595.28, pageHeight: 841.89, margins: { top: 54, right: 54, bottom: 54, left: 54 }, bodySize: 11 },
    )
    const p = await parts(bytes)
    expect(p.names).toEqual(['[Content_Types].xml', '_rels/', '_rels/.rels', 'docProps/', 'docProps/app.xml', 'docProps/core.xml', 'word/', 'word/_rels/', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/media/', 'word/media/image1.png', 'word/styles.xml'])
    const doc = await p.text('word/document.xml')
    expect(doc).toContain('<w:pStyle w:val="Heading1"/>')
    expect(doc).toContain('Title &lt;1&gt;')
    expect(doc).toContain('<w:bidi/>')
    expect(doc).toContain('<w:r><w:tab/></w:r>')
    expect(doc).toContain('<w:br w:type="page"/>')
    // The picture is scaled to the text width: 487.28 pt = 6188456 EMU.
    expect(doc).toContain('<wp:extent cx="6188456" cy="3094228"/>')
    expect(new DOMParserLite(doc).ok).toBe(true)
  })
  it('writes a workbook with numbers, formats, right-to-left sheets and unique names', async () => {
    const bytes = await buildXlsx(
      [
        { name: 'Page 1', grid: { rows: [['Item', 'Amount'], ['Rent', '24,000.00'], ['Share', '7.2%']], widths: [60, 80], rtl: false } },
        { name: 'Page 1', grid: { rows: [['البند']], widths: [50], rtl: true } },
      ],
      { title: 'T', numbers: true },
    )
    const p = await parts(bytes)
    const s1 = await p.text('xl/worksheets/sheet1.xml')
    expect(s1).toContain('<c r="B2" s="1"><v>24000</v></c>')
    expect(s1).toContain('<c r="B3" s="2"><v>0.072</v></c>')
    expect(s1).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">Item</t></is></c>')
    expect(await p.text('xl/worksheets/sheet2.xml')).toContain('rightToLeft="1"')
    const wb = await p.text('xl/workbook.xml')
    expect(wb).toContain('name="Page 1"')
    expect(wb).toContain('name="Page 1 2"')
    expect(await p.text('xl/styles.xml')).toContain('formatCode="#,##0.00"')
  })
  it('writes a presentation with one picture slide per page, sized to the page', async () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff])
    const bytes = await buildPptx([{ image: jpg, ext: 'jpeg', width: 595.28, height: 841.89 }, { image: jpg, ext: 'jpeg', width: 841.89, height: 595.28 }], { title: 'T' })
    const p = await parts(bytes)
    expect(p.names.filter((n) => /slides\/slide\d+\.xml$/.test(n))).toEqual(['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml'])
    expect(await p.text('ppt/presentation.xml')).toContain('<p:sldSz cx="7560056" cy="10692003"/>')
    // The landscape page is fitted inside the portrait slide, centred.
    expect(await p.text('ppt/slides/slide2.xml')).toMatch(/<a:off x="0" y="\d+"\/><a:ext cx="7560056" cy="\d+"\/>/)
  })
})

/** Well-formedness check without a DOM: balanced tags and no raw '&' or '<' in text. */
class DOMParserLite {
  ok: boolean
  constructor(xml: string) {
    const stack: string[] = []
    let ok = !/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(xml)
    for (const m of xml.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)[^>]*?(\/?)>/g)) {
      if (m[3]) continue
      if (m[1]) { if (stack.pop() !== m[2]) ok = false } else stack.push(m[2])
    }
    this.ok = ok && stack.length === 0
  }
}
