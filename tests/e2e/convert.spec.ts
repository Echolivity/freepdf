import { expect, test } from './fixtures'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { runAndDownload, runAndDownloadZip, upload } from './helpers'

// Conversion batch 1: TIFF → PDF, TXT → PDF, PDF → WebP / TXT / HTML. Everything runs in the tab;
// the global privacy guard (fixtures.ts) fails any test whose files would leave the origin.

test.describe('TIFF to PDF', () => {
  test('a multi-page LZW TIFF and a CCITT fax become one PDF at their real sizes', async ({ page }) => {
    await page.goto('/tiff-to-pdf')
    await upload(page, 'convert/two-pages-lzw.tif', 'convert/fax-g4.tif')
    await expect(page.getByRole('group', { name: 'TIFF pages' })).toBeVisible()
    await page.getByText('Fit image', { exact: true }).click()
    await page.getByText('None', { exact: true }).click()
    const { bytes, name } = await runAndDownload(page)
    expect(name).toBe('two-pages-lzw-and-more.pdf')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(3)
    const sizes = doc.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())])
    // 600×400 px at 150 dpi = 288×192 pt; 1700×2200 px at 200 dpi = US Letter.
    expect(sizes).toEqual([[288, 192], [192, 288], [612, 792]])
    await expect(page.getByText('3 pages')).toBeVisible()
  })

  test('JPEG-in-TIFF, PackBits and Deflate-with-alpha TIFFs convert, one PDF each', async ({ page }) => {
    await page.goto('/tiff-to-pdf')
    await upload(page, 'convert/rgb-jpeg.tif', 'convert/gray-packbits.tif', 'convert/rgba-deflate.tif')
    await page.getByText('PDF per image', { exact: true }).click()
    await page.getByText('Smaller', { exact: true }).click()
    const { bytes } = await runAndDownloadZip(page)
    const zip = await JSZip.loadAsync(bytes)
    const names = Object.keys(zip.files).sort()
    expect(names).toEqual(['gray-packbits.pdf', 'rgb-jpeg.pdf', 'rgba-deflate.pdf'])
    for (const n of names) expect((await PDFDocument.load(await zip.files[n].async('uint8array'))).getPageCount()).toBe(1)
  })

  test('a truncated TIFF fails with a clear message, and TIFFs are accepted by JPG to PDF too', async ({ page }) => {
    await page.goto('/jpg-to-pdf')
    await upload(page, 'convert/truncated.tif')
    await page.getByTestId('run').click()
    await expect(page.getByRole('alert')).toContainText(/TIFF/)
  })
})

test.describe('TXT to PDF', () => {
  test('converts mixed Arabic/English text with options, and reports the encoding', async ({ page }) => {
    await page.goto('/txt-to-pdf')
    await upload(page, 'convert/notes.txt')
    await page.getByText('Serif', { exact: true }).click()
    await page.getByLabel('Size').selectOption('12')
    await page.getByText('Letter', { exact: true }).click()
    const { bytes, name } = await runAndDownload(page)
    expect(name).toBe('notes.pdf')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(2) // the form feed starts page 2
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 })
    await expect(page.getByText(/2 pages · UTF-8 · used the Arabic \+ Latin font/)).toBeVisible()
  })

  test('several files give a ZIP; a legacy file is read as Windows-1252 and says so', async ({ page }) => {
    await page.goto('/txt-to-pdf')
    await upload(page, 'convert/latin1.txt', 'convert/utf16.txt')
    await expect(page.getByTestId('run')).toHaveText('Convert 2 files to PDF')
    const { bytes } = await runAndDownloadZip(page)
    expect(Object.keys((await JSZip.loadAsync(bytes)).files).sort()).toEqual(['latin1.pdf', 'utf16.pdf'])
    await expect(page.getByText(/not UTF-8, read as Windows-1252/)).toBeVisible()
    await expect(page.getByText(/1 page · read as UTF-16/)).toBeVisible()
  })

  test('binary data named .txt is rejected before processing', async ({ page }) => {
    await page.goto('/txt-to-pdf')
    await upload(page, 'convert/binary.txt')
    await expect(page.getByRole('alert')).toContainText('binary.txt')
    await expect(page.getByTestId('run')).toHaveCount(0)
  })
})

test.describe('PDF to WebP', () => {
  test('exports chosen pages as real WebP images', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit cannot encode WebP; covered by the next test')
    await page.goto('/pdf-to-webp')
    await upload(page, 'text-8p.pdf')
    await expect(page.getByRole('radio', { name: /^WebP/ })).toBeChecked()
    await page.getByTestId('page-range').fill('2-3, last')
    const { bytes } = await runAndDownloadZip(page)
    const zip = await JSZip.loadAsync(bytes)
    const names = Object.keys(zip.files).sort()
    expect(names).toEqual(['text-8p-page-2.webp', 'text-8p-page-3.webp', 'text-8p-page-8.webp'])
    const head = await zip.files[names[0]].async('uint8array')
    expect(String.fromCharCode(...head.subarray(0, 4)) + String.fromCharCode(...head.subarray(8, 12))).toBe('RIFFWEBP')
  })

  test('without a WebP encoder, the option is hidden and the tool explains why', async ({ page }) => {
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.toDataURL
      HTMLCanvasElement.prototype.toDataURL = function (type?: string, q?: unknown) {
        return type === 'image/webp' ? orig.call(this, 'image/png') : orig.call(this, type, q)
      }
    })
    await page.goto('/pdf-to-webp')
    await upload(page, 'text-8p.pdf')
    await expect(page.getByText(/can’t create WebP images/)).toBeVisible()
    await expect(page.getByRole('radio', { name: /^WebP/ })).toHaveCount(0)
    await expect(page.getByRole('radio', { name: /^PNG/ })).toBeChecked()
  })

  test('a malformed page range blocks the run with a message', async ({ page }) => {
    await page.goto('/pdf-to-jpg')
    await upload(page, 'text-8p.pdf')
    await page.getByTestId('page-range').fill('2-x')
    await expect(page.getByRole('alert')).toContainText('2-x')
    await expect(page.getByTestId('run')).toBeDisabled()
  })
})

test.describe('PDF to TXT', () => {
  test('extracts text with page markers', async ({ page }) => {
    await page.goto('/pdf-to-txt')
    await upload(page, 'text-8p.pdf')
    await page.getByTestId('page-range').fill('1-2')
    const { bytes, name } = await runAndDownload(page)
    expect(name).toBe('text-8p.txt')
    const text = bytes.toString('utf8')
    expect(text.startsWith('Page 1\n\n')).toBe(true)
    expect(text).toContain('\n\n\nPage 2\n\n')
    expect(text).not.toContain('Page 3\n')
  })

  test('Arabic PDFs come out in reading order', async ({ page }) => {
    await page.goto('/pdf-to-txt')
    await upload(page, 'arabic.pdf')
    await page.getByRole('checkbox', { name: /Mark where each page starts/ }).uncheck()
    const { bytes } = await runAndDownload(page)
    const text = bytes.toString('utf8')
    expect(text).toContain('الصفحة 1: عقد إيجار')
    expect(text).toContain('١٤٤٨/٠٥/٠١')
    expect(text).toContain('Contract reference: FP-2026-001 — مرجع العقد.')
  })

  test('a PDF with no text layer explains that OCR is not available', async ({ page }) => {
    await page.goto('/txt-to-pdf')
    // Make an image-only PDF in the app itself: an image converted to PDF has no text.
    await page.goto('/jpg-to-pdf')
    await upload(page, 'photo.jpg')
    const { bytes } = await runAndDownload(page)
    await page.goto('/pdf-to-txt')
    await page.getByTestId('file-input').first().setInputFiles({ name: 'photo.pdf', mimeType: 'application/pdf', buffer: bytes })
    await page.getByTestId('run').click()
    await expect(page.getByRole('alert')).toContainText(/no text to extract.*OCR/)
  })
})

test.describe('PDF to HTML', () => {
  test('flowing text: one self-contained, script-free HTML file', async ({ page }) => {
    await page.goto('/pdf-to-html')
    await upload(page, 'text-8p.pdf')
    const { bytes, name } = await runAndDownload(page)
    expect(name).toBe('text-8p.html')
    const html = bytes.toString('utf8')
    expect(html).toMatch(/^<!DOCTYPE html>/)
    expect(html).toContain(`default-src 'none'`)
    expect(html).not.toMatch(/<script|https?:\/\/(?!www\.w3\.org)/i)
    expect(html).toContain('id="page-8"')
  })

  test('exact layout: page images with selectable text that opens and renders', async ({ page, context }) => {
    await page.goto('/pdf-to-html')
    await upload(page, 'rich.pdf')
    await page.getByText('Exact layout', { exact: true }).click()
    await page.getByText('Screen', { exact: true }).click()
    const { bytes } = await runAndDownload(page)
    const html = bytes.toString('utf8')
    expect(html.match(/<image href="data:image\/jpeg;base64,/g)).toHaveLength(4)
    expect(html).toContain('<text ')
    // Open the exported file on its own: it must render four pages and expose the text.
    const view = await context.newPage()
    await view.setContent(html)
    await expect(view.locator('figure.page')).toHaveCount(4)
    expect(await view.locator('svg text').first().textContent()).toBeTruthy()
    await view.close()
  })
})
