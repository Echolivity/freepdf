import { expect, test } from './fixtures'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { runAndDownload, runAndDownloadZip, upload } from './helpers'
import { pageTexts } from '../unit/render'
import { fixArabic } from '../../src/lib/convert/pdfText'

// Conversion batch 2: Word / Excel / HTML → PDF and PDF → Word / Excel / PowerPoint, all in the tab.
// The global privacy guard (fixtures.ts) fails any test that makes an outside request.

test.describe('Word to PDF', () => {
  test('keeps headings, lists, the table, the picture, page breaks and the footer on each page', async ({ page }) => {
    await page.goto('/word-to-pdf')
    await upload(page, 'office/report.docx')
    const { bytes, name } = await runAndDownload(page)
    expect(name).toBe('report.pdf')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getPage(0).getSize().width).toBeCloseTo(595.3, 0)
    const [p1, p2] = await pageTexts(bytes)
    for (const s of ['Quarterly Report', 'Revenue grew 12%', '1. Collect the data', '3. Publish the report', 'North 1,200 1,350', 'Centred closing line.', 'FreePDF test footer']) expect(p1).toContain(s)
    expect(p1).toContain('•')
    expect(p2).toContain('Appendix')
    expect(p2).toContain('FreePDF test footer')
  })

  test('an Arabic document stays right-to-left and readable', async ({ page }) => {
    await page.goto('/word-to-pdf')
    await upload(page, 'office/arabic.docx')
    const { bytes } = await runAndDownload(page)
    const [text] = await pageTexts(bytes)
    expect(text).toContain('تقرير المبيعات')
    expect(text).toContain('24,000')
    expect(text).toContain('الشمال')
  })

  test('old .doc files are refused with an explanation', async ({ page }) => {
    await page.goto('/word-to-pdf')
    await page.getByTestId('file-input').first().setInputFiles({ name: 'old.docx', mimeType: 'application/msword', buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]) })
    await expect(page.getByRole('alert')).toContainText('old-format')
  })
})

test.describe('Excel to PDF', () => {
  test('prints each sheet with number formats, and right-to-left sheets', async ({ page }) => {
    await page.goto('/excel-to-pdf')
    await upload(page, 'office/sheet.xlsx')
    const { bytes } = await runAndDownload(page)
    const [p1, p2] = await pageTexts(bytes)
    for (const s of ['Sales 2026', 'Region', '2026-01-15', '1,234.50', '7.2%', '15,000.00', '87.1%', '17,221.75']) expect(p1).toContain(s)
    // PDF.js reads the lam-alef ligature back as two swapped letters; FreePDF's own text export
    // repairs that (fixArabic), and so does this check.
    expect(fixArabic(p2)).toContain('الإيجار')
    expect(p2).toContain('24,000')
    await expect(page.getByText(/2 pages · 2 sheet/)).toBeVisible()
  })
})

test.describe('HTML to PDF', () => {
  test('uses only what is in the file: scripts, frames and remote resources are left out', async ({ page }) => {
    await page.goto('/html-to-pdf')
    await upload(page, 'office/page.html')
    const { bytes } = await runAndDownload(page)
    const [text] = await pageTexts(bytes)
    for (const s of ['HTML to PDF', 'A styled box with bold and italic text.', 'First item', '3.', 'Fourth', 'Alpha', '[remote image]', 'فقرة عربية']) expect(text).toContain(s)
    expect(text).not.toContain('pwned')
    await expect(page.getByText(/external or active items left out/)).toBeVisible()
    // The document's styles stayed inside the conversion: the app's own heading is unchanged.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('color', /rgb\((19, 20, 24|238, 235, 227)\)/)
  })
})

test.describe('PDF to Word, Excel and PowerPoint', () => {
  const zipText = async (bytes: Buffer, part: string) => (await JSZip.loadAsync(bytes)).file(part)!.async('string')

  test('PDF to Word: headings, list items, paragraphs, the table and the picture', async ({ page }) => {
    await page.goto('/pdf-to-word')
    await upload(page, 'office/report-lo.pdf')
    const { bytes, name } = await runAndDownload(page)
    expect(name).toBe('report-lo.docx')
    const zip = await JSZip.loadAsync(bytes)
    expect(Object.keys(zip.files)).toContain('word/media/image1.jpeg')
    const xml = await zipText(bytes, 'word/document.xml')
    expect(xml).toMatch(/<w:pStyle w:val="Heading1"\/><\/w:pPr><w:r><w:rPr><\/w:rPr><w:t xml:space="preserve">Quarterly Report<\/w:t>/)
    expect(xml).toContain('>• Revenue grew 12%<')
    expect(xml).toContain('<w:br w:type="page"/>')
    // The Region / Q1 / Q2 table comes back as a real Word table, numbers end-aligned.
    expect(xml.match(/<w:tbl>/g)).toHaveLength(1)
    const table = xml.slice(xml.indexOf('<w:tbl>'), xml.indexOf('</w:tbl>'))
    expect([...table.matchAll(/<w:tr>/g)]).toHaveLength(4)
    expect([...table.matchAll(/<w:t xml:space="preserve">([^<]*)</g)].map((m) => m[1])).toEqual(['Region', 'Q1', 'Q2', 'North', '1,200', '1,350', 'South', '980', '1,010', 'Total', '2,180', '2,360'])
    expect(table).toContain('<w:jc w:val="right"/>')
    await expect(page.getByText(/2 pages · 1 picture\(s\) · 1 table/)).toBeVisible()
  })

  test('PDF to Word keeps Arabic right-to-left and in reading order', async ({ page }) => {
    await page.goto('/pdf-to-word')
    await upload(page, 'office/arabic-lo.pdf')
    const { bytes } = await runAndDownload(page)
    const xml = await zipText(bytes, 'word/document.xml')
    expect(xml).toContain('<w:bidi/>')
    expect(xml).toContain('بلغت المبيعات 24,000 ريال في الربع الأول من عام 2026')
  })

  test('PDF to Excel: real numbers with formats, one sheet per page, right-to-left sheet', async ({ page }) => {
    await page.goto('/pdf-to-excel')
    await upload(page, 'office/sheet-lo.pdf')
    const { bytes } = await runAndDownload(page)
    const s1 = await zipText(bytes, 'xl/worksheets/sheet1.xml')
    expect(s1).toMatch(/<c r="C3" s="\d+"><v>1234.5<\/v><\/c>/)
    expect(s1).toMatch(/<c r="D3" s="\d+"><v>0.072<\/v><\/c>/)
    expect(s1).toContain('>North<')
    const s2 = await zipText(bytes, 'xl/worksheets/sheet2.xml')
    expect(s2).toContain('rightToLeft="1"')
    expect(s2).toContain('>الإيجار<')
    await expect(page.getByText(/2 sheets · 9 rows/)).toBeVisible()
  })

  test('PDF to PowerPoint: editable text over a text-free picture; several files give a ZIP', async ({ page }) => {
    await page.goto('/pdf-to-powerpoint')
    await upload(page, 'office/report-lo.pdf', 'text-8p.pdf')
    await page.getByTestId('page-range').fill('1-2')
    const { bytes } = await runAndDownloadZip(page)
    const outer = await JSZip.loadAsync(bytes)
    expect(Object.keys(outer.files).sort()).toEqual(['report-lo.pptx', 'text-8p.pptx'])
    const deck = await JSZip.loadAsync(await outer.files['text-8p.pptx'].async('uint8array'))
    expect(Object.keys(deck.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toHaveLength(2)
    expect(Object.keys(deck.files).filter((n) => /^ppt\/media\/image\d+\.jpeg$/.test(n))).toHaveLength(2)
    const report = await JSZip.loadAsync(await outer.files['report-lo.pptx'].async('uint8array'))
    const s1 = await report.file('ppt/slides/slide1.xml')!.async('string')
    expect(s1).toContain('<a:t>Quarterly Report</a:t>')
    expect(s1).toContain('<a:t>Region</a:t>')
    // The heading keeps its blue (sampled from the page).
    const hex = /<a:srgbClr val="([0-9A-F]{6})"\/><\/a:solidFill><a:latin typeface="Arial"\/><a:cs typeface="Arial"\/><\/a:rPr><a:t>Quarterly Report/.exec(s1)![1]
    const [r, , b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
    expect(b - r).toBeGreaterThan(40)
  })

  test('PDF to PowerPoint: Pictures gives exact page pictures with no text boxes', async ({ page }) => {
    await page.goto('/pdf-to-powerpoint')
    await upload(page, 'office/report-lo.pdf')
    await page.getByText('Pictures', { exact: true }).click()
    const { bytes } = await runAndDownload(page)
    const s1 = await (await JSZip.loadAsync(bytes)).file('ppt/slides/slide1.xml')!.async('string')
    expect(s1).not.toContain('txBox')
    await expect(page.getByText(/^2 slides$/)).toBeVisible()
  })

  test('PDF to Excel on a PDF without text, with OCR off, explains why', async ({ page }) => {
    await page.goto('/jpg-to-pdf')
    await upload(page, 'photo.jpg')
    const { bytes } = await runAndDownload(page)
    await page.goto('/pdf-to-excel')
    await page.getByTestId('file-input').first().setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: bytes })
    await page.getByTestId('conv-ocr').uncheck()
    await page.getByTestId('run').click()
    await expect(page.getByRole('alert')).toContainText(/no text to extract/)
  })
})
