import { test, expect } from './fixtures'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { upload, runAndDownload } from './helpers'

// OCR runs for real here (tesseract.js in the browser, served from /ocr). The scans are synthetic
// (scripts/make-ocr-fixtures.py): rendered from text fixtures, tilted slightly, with scanner specks.

async function pdfText(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) } as never)
  const doc = await task.promise
  let text = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent()
    text += c.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n'
  }
  const pages = doc.numPages
  await task.destroy()
  return { pages, text: text.replace(/\s+/g, ' ') }
}

test.describe('OCR', () => {
  test.describe.configure({ timeout: 180_000 })

  test('English scan to a searchable PDF: same page, recognised text selectable', async ({ page }) => {
    await page.goto('/ocr-pdf')
    await upload(page, 'ocr/scan-en.pdf')
    const { bytes, name } = await runAndDownload(page)
    expect(name).toMatch(/^scan-en[-_]ocr\.pdf$/)
    await expect(page.getByText(/1 page recognised · \d+% average confidence/)).toBeVisible()
    const { pages, text } = await pdfText(bytes)
    expect(pages).toBe(1)
    for (const phrase of ['Quarterly Report', 'Revenue grew 12%', 'Publish the report', 'Centred closing line']) expect(text).toContain(phrase)
    // The scan itself is unchanged: the original image stream is carried over byte for byte.
    const original = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'ocr', 'scan-en.pdf'))
    const jpeg = original.subarray(original.indexOf(Buffer.from([0xff, 0xd8, 0xff])), original.indexOf(Buffer.from([0xff, 0xd9]), original.length - 200_000) + 2)
    expect(Buffer.from(bytes).includes(jpeg.subarray(0, 4096))).toBe(true)
  })

  test('Arabic scan to text', async ({ page }) => {
    await page.goto('/ocr-pdf')
    await upload(page, 'ocr/scan-ar.pdf')
    await page.getByText('Arabic', { exact: true }).click()
    await page.getByText('Text', { exact: true }).click()
    const { bytes, name } = await runAndDownload(page)
    expect(name).toBe('scan-ar.txt')
    const text = bytes.toString('utf8').replace(/\s+/g, ' ')
    expect(text).toContain('تقرير المبيعات')
    expect(text).toContain('هذه فقرة ثانية طويلة بما يكفي')
    expect(text).toContain('العربية واتجاهها من اليمين إلى اليسار')
  })

  test('a photo of a page becomes a one-page searchable PDF', async ({ page }) => {
    await page.goto('/ocr-pdf')
    await upload(page, 'ocr/photo-en.jpg')
    const { bytes } = await runAndDownload(page)
    const { pages, text } = await pdfText(bytes)
    expect(pages).toBe(1)
    expect(text).toContain('Quarterly Report')
  })

  test('pages that already have text are skipped; a PDF with only text explains why nothing was done', async ({ page }) => {
    await page.goto('/ocr-pdf')
    await upload(page, 'ocr/mixed.pdf')
    await page.getByText('Arabic', { exact: true }).click()
    const { bytes } = await runAndDownload(page)
    await expect(page.getByText(/1 page recognised \(\d+% confidence\) · 1 already had text/)).toBeVisible()
    const { pages, text } = await pdfText(bytes)
    expect(pages).toBe(2)
    expect(text).toContain('Quarterly Report') // page 1, its own text
    expect(text).toContain('هذه فقرة ثانية') // page 2, recognised
    await page.getByTestId('start-over').click()
    await upload(page, 'text-8p.pdf')
    await page.getByTestId('run').click()
    await expect(page.getByRole('alert')).toContainText('Every page of “text-8p.pdf” already has text')
  })

  test('a scanned bank statement is read with OCR and checked against the running balance', async ({ page }) => {
    await page.goto('/bank-statement-to-excel')
    await upload(page, 'ocr/scan-statement.pdf')
    await page.getByText('CSV', { exact: true }).click()
    const { bytes } = await runAndDownload(page)
    await expect(page.getByText(/39 transactions read by OCR|39 transactions · \d balance/)).toBeVisible()
    const rows = bytes.toString('utf8').replace(/^﻿/, '').trim().split('\r\n').slice(1)
    const expected = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'statements', 'en-statement.expected.json'), 'utf8')).transactions as { date: string; balance: number }[]
    expect(rows).toHaveLength(39)
    // Dates and balances as printed; at most a couple of OCR misreads, which are flagged, not hidden.
    const exact = rows.filter((r, i) => r.startsWith(expected[i].date) && r.includes(`,${expected[i].balance.toFixed(2)},`)).length
    expect(exact).toBeGreaterThanOrEqual(37)
    expect(rows.filter((r) => !/,OK$/.test(r)).length).toBe(39 - exact)
  })
})
