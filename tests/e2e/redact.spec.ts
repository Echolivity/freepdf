import { test, expect, type Page } from './fixtures'
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { upload, runAndDownload } from './helpers'

// The letter comes from scripts/make-redact-fixtures.mjs: invented personal details in English and
// Arabic on page 1, a reference code on page 2, and a title and author in its metadata.

async function pdfTexts(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) } as never)
  const doc = await task.promise
  const out: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent()
    out.push(c.items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' '))
  }
  await task.destroy()
  return out
}

/** Every object in the file, streams decompressed, as one string. */
async function everything(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const parts: string[] = []
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try { parts.push(Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1')) } catch { /* image data */ }
      parts.push(obj.dict.toString())
    } else parts.push(obj.toString())
  }
  return parts.join('\n')
}

async function open(page: Page) {
  await page.goto('/redact-pdf')
  await upload(page, 'redact/letter.pdf')
  await expect(page.getByTestId('rd-summary')).toContainText('Nothing marked yet')
}

test.describe('Redact PDF', () => {
  test('finds personal details, removes them for real, keeps the rest searchable', async ({ page }) => {
    await open(page)
    await expect(page.getByTestId('run')).toBeDisabled()
    await page.getByTestId('rd-query').fill('Sara Example, سارة')
    for (const id of ['email', 'phone', 'iban', 'card', 'id']) await page.getByTestId(`rd-pattern-${id}`).check()
    await page.getByTestId('rd-search').click()
    // Name, Arabic name, email, phone, IBAN, ID, card and the Arabic phone number.
    await expect(page.getByTestId('rd-found')).toContainText(/matches marked on 1 page\./)
    const marks = await page.getByTestId('rd-mark').count()
    expect(marks).toBeGreaterThanOrEqual(8)

    const { bytes, name } = await runAndDownload(page)
    expect(name).toBe('letter-redacted.pdf')
    await expect(page.getByText(/areas redacted on 1 page$/)).toBeVisible()
    const [p1, p2] = await pdfTexts(bytes)
    for (const s of ['Customer:', 'Email:', 'Mobile:', 'IBAN:', 'confirms that the account above is active']) expect(p1).toContain(s)
    expect(p2).toContain('Reference code ZX-99-ALPHA')
    const all = await everything(bytes)
    for (const secret of ['Sara Example', 'sara.example', '123 4567', '6080 1016', '1012345678', '4111 1111']) {
      expect(p1).not.toContain(secret)
      expect(all).not.toContain(secret)
    }
    expect(p1).not.toContain('سارة')
    expect(p1).not.toContain('٠٥٠١٢٣٤٥٦٧')
    // Hidden information (title, author) went too.
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(doc.getTitle()).toBeUndefined()
    expect(doc.getAuthor()).toBeUndefined()
  })

  test('a box drawn by hand, moved with the keyboard; whole-page redaction', async ({ page }) => {
    await open(page)
    const surface = page.getByTestId('rd-surface-2')
    // Keep the page's top clear of the sticky site header.
    await surface.evaluate((e) => { e.scrollIntoView({ block: 'start' }); window.scrollBy(0, -200) })
    const b = (await surface.boundingBox())!
    // Page 2's second line ("Reference code …") sits about 10.3% down the page.
    await page.mouse.move(b.x + b.width * 0.08, b.y + b.height * 0.085)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width * 0.9, b.y + b.height * 0.115, { steps: 5 })
    await page.mouse.up()
    await expect(page.getByTestId('rd-mark')).toHaveCount(1)
    const mark = page.getByTestId('rd-mark')
    await mark.focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('rd-summary')).toContainText('1 area marked on 1 page')
    // A click without dragging doesn't make a box.
    await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.6)
    await expect(page.getByTestId('rd-mark')).toHaveCount(1)
    await page.getByTestId('rd-whole-1').click()
    await expect(page.getByTestId('rd-summary')).toContainText('2 areas marked on 2 pages')

    const { bytes } = await runAndDownload(page)
    const [p1, p2] = await pdfTexts(bytes)
    expect(p1.trim()).toBe('')
    expect(p2).toContain('Page two: terms and conditions apply.')
    expect(p2).not.toContain('ZX-99')
    expect(await everything(bytes)).not.toContain('ZX-99')
  })

  test('removing a mark, clearing all, and an image-only result', async ({ page }) => {
    await open(page)
    await page.getByTestId('rd-pattern-email').check()
    await page.getByTestId('rd-search').click()
    await expect(page.getByTestId('rd-found')).toContainText('1 match marked on 1 page')
    await page.getByTestId('rd-mark').click()
    await page.getByTestId('rd-remove').click()
    await expect(page.getByTestId('rd-mark')).toHaveCount(0)
    await page.getByTestId('rd-query').fill('nothing like this here')
    await page.getByTestId('rd-pattern-email').uncheck()
    await page.getByTestId('rd-search').click()
    await expect(page.getByTestId('rd-found')).toContainText('Nothing found')
    await page.getByTestId('rd-query').fill('Card')
    await page.getByTestId('rd-search').click()
    await page.getByTestId('rd-keep-text').uncheck()
    await page.getByTestId('rd-sanitize').uncheck()
    const { bytes } = await runAndDownload(page)
    const [p1, p2] = await pdfTexts(bytes)
    expect(p1.trim()).toBe('')
    expect(p2).toContain('Reference code')
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(doc.getTitle()).toBe('Account letter for Sara Example')
  })
})
