import { test, expect } from './fixtures'
import { readFileSync } from 'node:fs'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import JSZip from 'jszip'
import { fixtureBytes, runAndDownload, runAndDownloadZip, upload, expectedDownloadName } from './helpers'
import { pageTexts, visualSizes } from '../unit/render'
import { qpdfCheck } from '../unit/helpers'

const LETTER = [612, 792]
const A5 = [419.53, 595.28]
const near = (a: number, b: number) => Math.abs(a - b) < 0.6

async function textPdf(pages: string[][]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const lines of pages) {
    const p = doc.addPage([595, 842])
    lines.forEach((l, i) => p.drawText(l, { x: 50, y: 780 - i * 22, size: 13, font }))
  }
  return Buffer.from(await doc.save())
}

test.describe('Resize PDF', () => {
  test('resizes mixed pages to Letter, keeping text and orientation', async ({ page }) => {
    await page.goto('/resize-pdf')
    await upload(page, 'rich.pdf')
    await page.getByTestId('rs-size').selectOption('letter')
    await expect(page.getByTestId('resize-preview')).toContainText('content at')
    const { bytes, name } = await runAndDownload(page)
    expect(name).toBe('rich-letter.pdf')
    expect(qpdfCheck(bytes)).toBe(true)
    const before = await visualSizes(fixtureBytes('rich.pdf'))
    const after = await visualSizes(bytes)
    after.forEach(([w, h], i) => {
      const [tw, th] = before[i][0] > before[i][1] ? [LETTER[1], LETTER[0]] : LETTER
      expect(near(w, tw) && near(h, th), `page ${i + 1}`).toBe(true)
    })
    expect(await pageTexts(bytes)).toEqual(await pageTexts(fixtureBytes('rich.pdf')))
  })

  test('custom size, selected pages, and validation messages', async ({ page }) => {
    await page.goto('/resize-pdf')
    await upload(page, 'text-8p.pdf')
    await page.getByTestId('rs-size').selectOption('custom')
    await page.getByTestId('rs-w').fill('5')
    await expect(page.getByRole('alert')).toContainText('between 1 and 200 inches')
    await expect(page.getByTestId('run')).toBeDisabled()
    await page.getByTestId('rs-w').fill('100')
    await page.getByTestId('rs-h').fill('100')
    await page.getByTestId('rs-margin').fill('60')
    await expect(page.getByRole('alert')).toContainText('margins are too large')
    await page.getByTestId('rs-margin').fill('5')
    await page.getByTestId('ranges').fill('2-3')
    const { bytes } = await runAndDownload(page)
    const sizes = await visualSizes(bytes)
    const mm100 = (100 * 72) / 25.4
    expect(near(sizes[1][0], mm100) && near(sizes[2][1], mm100)).toBe(true)
    expect(sizes[0]).toEqual(sizes[3]) // untouched pages keep their A4 size
    expect(near(sizes[0][0], 595)).toBe(true)
  })

  test('several files come back as a ZIP; protected files get a clear error', async ({ page }) => {
    await page.goto('/resize-pdf')
    await upload(page, 'text-8p.pdf', 'structured.pdf')
    await page.getByTestId('rs-size').selectOption('a5')
    const { bytes } = await runAndDownloadZip(page)
    const zip = await JSZip.loadAsync(bytes)
    const names = Object.keys(zip.files).sort()
    expect(names).toEqual(['structured-a5.pdf', 'text-8p-a5.pdf'])
    const s = await visualSizes(await zip.file('structured-a5.pdf')!.async('uint8array'))
    expect(near(s[0][0], A5[0]) && near(s[0][1], A5[1])).toBe(true)

    await page.getByTestId('start-over').click()
    await upload(page, 'encrypted-user.pdf')
    await page.getByTestId('run').click()
    await expect(page.getByRole('alert')).toContainText('password-protected')
  })

  test('works in Arabic with an Arabic file name', async ({ page, browserName }) => {
    await page.addInitScript(() => localStorage.setItem('freepdf:lang', 'ar'))
    await page.goto('/resize-pdf')
    await page.getByTestId('file-input').setInputFiles({ name: 'عقد إيجار.pdf', mimeType: 'application/pdf', buffer: fixtureBytes('arabic.pdf') })
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('تغيير حجم PDF')
    await page.getByTestId('rs-size').selectOption('a5')
    const { bytes, name } = await runAndDownload(page)
    expect(name).toBe(expectedDownloadName('عقد إيجار-a5.pdf', browserName))
    expect((await pageTexts(bytes))[0]).toEqual((await pageTexts(fixtureBytes('arabic.pdf')))[0])
  })
})

test.describe('Compare PDF', () => {
  test('highlights text changes, shows the overlay, scans visually and exports a report', async ({ page }) => {
    const a = await textPdf([['Payment is due within 30 days.', 'Unchanged line.'], ['Second page.'], ['Third page.']])
    const b = await textPdf([['Payment is due within 45 days.', 'Unchanged line.'], ['Second page.'], ['Third page.', 'A new clause appears here.']])
    await page.goto('/compare-pdf')
    await page.getByTestId('file-input').setInputFiles([
      { name: 'contract-v1.pdf', mimeType: 'application/pdf', buffer: a },
      { name: 'contract-v2.pdf', mimeType: 'application/pdf', buffer: b },
    ])
    await expect(page.getByRole('list', { name: 'Selected files' })).toContainText('Original')
    await expect(page.getByRole('list', { name: 'Selected files' })).toContainText('Changed version')
    await page.getByTestId('run').click()
    await expect(page.getByRole('heading', { name: '2 text changes found' })).toBeFocused({ timeout: 30_000 })
    await expect(page.getByTestId('cmp-stats')).toContainText('Words removed: 1 · words added: 6')
    await expect(page.getByTestId('cmp-pages').getByRole('button')).toHaveText(['1', '3'])
    await expect(page.getByTestId('cmp-changes')).toContainText('30')
    await expect(page.getByTestId('cmp-changes')).toContainText('45')
    await expect(page.getByRole('img', { name: /Original, page 1/ })).toBeVisible()

    await page.getByTestId('cmp-pages').getByRole('button', { name: '3' }).click()
    await expect(page.getByTestId('cmp-page')).toHaveText('Page 3 of 3')
    await expect(page.getByTestId('cmp-changes')).toContainText('A new clause appears here.')

    await page.locator('label').filter({ hasText: 'Difference overlay' }).click()
    await expect(page.getByTestId('cmp-ratio')).toContainText('% of pixels differ', { timeout: 20_000 })
    const pct = Number((await page.getByTestId('cmp-ratio').textContent())!.match(/([\d.]+)%/)![1])
    expect(pct).toBeGreaterThan(0)

    await page.getByTestId('cmp-scan').click()
    await expect(page.getByTestId('cmp-scan-result')).toHaveText('2 pages look different.', { timeout: 30_000 })

    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('cmp-report').click()])
    expect(dl.suggestedFilename()).toBe('contract-v2-comparison.pdf')
    const report = readFileSync((await dl.path())!)
    expect(qpdfCheck(report)).toBe(true)
    expect((await PDFDocument.load(report)).getPageCount()).toBe(2)
  })

  test('identical files, file-count rules, and protected files', async ({ page }) => {
    await page.goto('/compare-pdf')
    await upload(page, 'text-8p.pdf', 'text-8p.pdf', 'scan.pdf')
    await expect(page.getByRole('alert')).toContainText('exactly two')
    await expect(page.getByTestId('run')).toBeDisabled()
    await page.getByRole('button', { name: /Remove scan\.pdf/ }).click()
    await page.getByTestId('run').click()
    await expect(page.getByRole('heading', { name: 'No text differences found' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('cmp-report')).toBeDisabled()

    await page.getByRole('button', { name: 'Start over' }).click()
    await upload(page, 'text-8p.pdf', 'encrypted-user.pdf')
    await page.getByTestId('run').click()
    await expect(page.getByRole('alert')).toContainText('password-protected')
  })

  test('works in Arabic (RTL) with Arabic documents', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('freepdf:lang', 'ar'))
    await page.goto('/compare-pdf')
    await upload(page, 'arabic.pdf', 'arabic.pdf')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await page.getByTestId('run').click()
    await expect(page.getByRole('heading', { name: 'لم يُعثر على فروق في النص' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('cmp-page')).toHaveText('الصفحة 1 من 3')
  })
})
