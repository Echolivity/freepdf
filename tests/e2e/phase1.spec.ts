import { test, expect, type Page, type Locator } from './fixtures'
import { readFileSync } from 'node:fs'
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import JSZip from 'jszip'
import { fixtureBytes, runAndDownload, runAndDownloadZip, upload } from './helpers'
import { pageTexts, visualSizes } from '../unit/render'
import { qpdfCheck } from '../unit/helpers'

const MM = 72 / 25.4
const firstLine = async (bytes: Uint8Array) => (await pageTexts(bytes)).map((t) => t.split(' ').slice(0, 2).join(' '))

/** Drag with pointer events, as a finger or mouse would (the grip captures the pointer). */
async function pointerDrag(page: Page, from: Locator, to: Locator, pointerType: 'mouse' | 'touch' = 'mouse') {
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  const base = { pointerId: 7, pointerType, isPrimary: true, button: 0, buttons: 1, bubbles: true }
  await from.dispatchEvent('pointerdown', { ...base, clientX: a.x + a.width / 2, clientY: a.y + a.height / 2 })
  for (let i = 1; i <= 4; i++) {
    await from.dispatchEvent('pointermove', { ...base, clientX: a.x + ((b.x + b.width / 2 - a.x) * i) / 4, clientY: a.y + ((b.y + b.height / 2 - a.y) * i) / 4 })
  }
  await from.dispatchEvent('pointerup', { ...base, buttons: 0, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 })
}

test.describe('Home and addresses', () => {
  test('category filter narrows the tool list', async ({ page }) => {
    await page.goto('/')
    const filter = page.getByTestId('category-filter')
    await filter.getByRole('button', { name: /^Edit/ }).click()
    await expect(filter.getByRole('button', { name: /^Edit/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Edit'])
    await expect(page.getByRole('link', { name: /Crop PDF/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Merge PDF/ })).toHaveCount(0)
    await filter.getByRole('button', { name: /^All tools/ }).click()
    await expect(page.getByRole('link', { name: /Merge PDF/ })).toBeVisible()
  })

  test('old tool addresses lead to the renamed tools', async ({ page }) => {
    const res = await page.goto('/extract-pages')
    if (process.env.PW_BASE_URL) expect(res?.request().redirectedFrom()?.url()).toMatch(/\/extract-pages$/) // Cloudflare 301
    await expect(page).toHaveURL(/\/extract-pdf$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Extract PDF pages')
    await page.goto('/remove-pages')
    await expect(page).toHaveURL(/\/delete-pages$/)
  })
})

test.describe('Extract and Delete pages', () => {
  test('extract odd pages as one PDF, then each as its own PDF', async ({ page }) => {
    await page.goto('/extract-pdf')
    await upload(page, 'text-8p.pdf')
    await page.getByTestId('pick-odd').click()
    await expect(page.getByTestId('ranges')).toHaveValue('1, 3, 5, 7')
    let { bytes } = await runAndDownload(page)
    expect(await firstLine(bytes)).toEqual(['Page 1', 'Page 3', 'Page 5', 'Page 7'])

    await page.getByTestId('start-over').click()
    await upload(page, 'text-8p.pdf')
    await page.getByTestId('pick-even').click()
    await page.getByText('Separate PDFs', { exact: true }).click()
    await expect(page.getByTestId('selection-summary')).toContainText('4 PDFs')
    ;({ bytes } = await runAndDownloadZip(page))
    const zip = await JSZip.loadAsync(bytes)
    expect(Object.keys(zip.files).sort()).toEqual(['text-8p-page-2.pdf', 'text-8p-page-4.pdf', 'text-8p-page-6.pdf', 'text-8p-page-8.pdf'])
    expect(await firstLine(await zip.file('text-8p-page-6.pdf')!.async('uint8array'))).toEqual(['Page 6'])

    await page.getByTestId('start-over').click()
    await upload(page, 'text-8p.pdf')
    await page.getByTestId('every-page').click()
    ;({ bytes } = await runAndDownloadZip(page))
    expect(Object.keys((await JSZip.loadAsync(bytes)).files)).toHaveLength(8)
  })

  test('delete with undo/redo and a preview of the result', async ({ page }) => {
    await page.goto('/delete-pages')
    await upload(page, 'text-8p.pdf')
    await page.getByRole('button', { name: 'Page 2', exact: true }).click()
    await page.getByRole('button', { name: 'Page 5', exact: true }).click()
    await expect(page.getByTestId('ranges')).toHaveValue('2, 5')
    await page.getByTestId('undo').click()
    await expect(page.getByTestId('ranges')).toHaveValue('2')
    await page.getByTestId('redo').click()
    await expect(page.getByTestId('ranges')).toHaveValue('2, 5')
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+Shift+z')
    await expect(page.getByTestId('ranges')).toHaveValue('2, 5')
    // Typing doesn't get rewritten under the cursor.
    await page.getByTestId('ranges').fill('2, 5, ')
    await expect(page.getByTestId('ranges')).toHaveValue('2, 5, ')
    await page.getByTestId('ranges').fill('2, 5')

    await page.getByTestId('preview').click()
    const dialog = page.getByTestId('preview-dialog')
    await expect(dialog.getByTestId('preview-count')).toHaveText('Result: 6 pages')
    const [dl] = await Promise.all([page.waitForEvent('download'), dialog.getByTestId('preview-download').click()])
    const fromPreview = readFileSync((await dl.path())!)
    expect(await firstLine(fromPreview)).toEqual(['Page 1', 'Page 3', 'Page 4', 'Page 6', 'Page 7', 'Page 8'])
    await dialog.getByTestId('preview-close').click()
    await expect(dialog).toBeHidden()
    const { bytes } = await runAndDownload(page)
    expect(await firstLine(bytes)).toEqual(await firstLine(fromPreview))
  })
})

test.describe('Organize PDF', () => {
  test('drag, duplicate, insert another PDF, undo, preview, save', async ({ page }) => {
    await page.goto('/organize-pdf')
    await upload(page, 'text-8p.pdf')
    const tiles = page.getByRole('list', { name: 'Pages' }).getByRole('listitem')
    await expect(tiles).toHaveCount(8)
    // Drag page 1 onto position 3 with the grip.
    await pointerDrag(page, page.getByTestId('grip-0'), tiles.nth(2))
    await expect(tiles.nth(2)).toContainText('1')
    await page.getByRole('button', { name: 'Duplicate page 4' }).click()
    await expect(tiles).toHaveCount(9)
    await page.getByTestId('undo').click()
    await expect(tiles).toHaveCount(8)
    await page.getByTestId('redo').click()
    await expect(tiles).toHaveCount(9)
    // Insert two pages of another PDF after the selected first tile.
    await page.getByRole('checkbox', { name: 'Select page 2' }).check()
    await page.getByTestId('file-input').last().setInputFiles('tests/fixtures/rich.pdf')
    await expect(page.getByTestId('sources')).toContainText('rich.pdf')
    await expect(tiles).toHaveCount(13)
    await page.getByRole('checkbox', { name: 'Select page A2' }).uncheck()
    // Delete the last two inserted pages (B3, B4) via selection.
    await page.getByRole('checkbox', { name: 'Select page B3' }).check()
    await page.getByRole('checkbox', { name: 'Select page B4' }).check()
    await expect(page.getByTestId('picked-count')).toHaveText('2 pages selected')
    await page.getByRole('group', { name: 'Actions for the selected pages' }).getByRole('button', { name: 'Delete' }).click()
    await expect(tiles).toHaveCount(11)

    await page.getByTestId('preview').click()
    await expect(page.getByTestId('preview-count')).toHaveText('Result: 11 pages')
    await page.getByTestId('preview-close').click()
    const { bytes } = await runAndDownload(page)
    expect(qpdfCheck(bytes)).toBe(true)
    // Expected: A2, B1, B2, A3, A1, A4, A4 (duplicate), A5, A6, A7, A8
    const full = await pageTexts(bytes)
    const lines = await firstLine(bytes)
    expect(lines).toHaveLength(11)
    expect([lines[0], lines[3], lines[4], lines[5], lines[6], lines[10]]).toEqual(['Page 2', 'Page 3', 'Page 1', 'Page 4', 'Page 4', 'Page 8'])
    expect(full[1]).toContain('595x842') // first page of rich.pdf
    expect(full[0]).not.toContain('595x842')
  })

  test('extract selected pages straight from the grid', async ({ page }) => {
    await page.goto('/organize-pdf')
    await upload(page, 'text-8p.pdf')
    await page.getByRole('checkbox', { name: 'Select page 6' }).check()
    await page.getByRole('checkbox', { name: 'Select page 2' }).check()
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('extract-selected').click()])
    expect(dl.suggestedFilename()).toBe('text-8p-selected.pdf')
    expect(await firstLine(readFileSync((await dl.path())!))).toEqual(['Page 2', 'Page 6'])
  })
})

test.describe('Crop PDF', () => {
  test('drag the crop box, type a margin, preview and crop all pages', async ({ page }) => {
    await page.goto('/crop-pdf')
    await upload(page, 'text-8p.pdf')
    await expect(page.getByTestId('crop-canvas')).toBeVisible()
    await page.getByTestId('crop-top').fill('20')
    const handle = page.getByTestId('crop-handle-left')
    await handle.scrollIntoViewIfNeeded()
    const h = (await handle.boundingBox())!
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
    await page.mouse.down()
    await page.mouse.move(h.x + 40, h.y + h.height / 2, { steps: 4 })
    await page.mouse.up()
    await expect.poll(async () => Number(await page.getByTestId('crop-left').inputValue())).toBeGreaterThan(10)
    await page.getByTestId('undo').click()
    await expect(page.getByTestId('crop-left')).toHaveValue('0')
    await page.getByTestId('crop-left').fill('15')
    await expect(page.getByTestId('crop-summary')).toHaveText('8 pages will be cropped.')
    await page.getByTestId('preview').click()
    await expect(page.getByTestId('preview-count')).toHaveText('Result: 8 pages')
    await page.getByTestId('preview-close').click()
    const { bytes, name } = await runAndDownload(page)
    expect(name).toBe('text-8p-cropped.pdf')
    const before = await visualSizes(fixtureBytes('text-8p.pdf'))
    const after = await visualSizes(bytes)
    after.forEach(([w, hh], i) => {
      expect(w).toBeCloseTo(before[i][0] - 15 * MM, 0)
      expect(hh).toBeCloseTo(before[i][1] - 20 * MM, 0)
    })
    expect(await pageTexts(bytes)).toEqual(await pageTexts(fixtureBytes('text-8p.pdf'))) // hidden, not deleted
  })

  test('a different crop for one page; too-large crops are refused', async ({ page }) => {
    await page.goto('/crop-pdf')
    await upload(page, 'rich.pdf')
    await page.getByText('Each page', { exact: true }).click()
    await page.getByRole('button', { name: 'Next page' }).click()
    await page.getByRole('button', { name: 'Next page' }).click()
    await expect(page.getByTestId('crop-page')).toHaveText('Page 3 of 4')
    await page.getByTestId('crop-bottom').fill('300')
    await expect(page.getByRole('alert')).toContainText('less than 12.7 mm')
    await expect(page.getByTestId('run')).toBeDisabled()
    await page.getByTestId('crop-bottom').fill('30')
    await expect(page.getByTestId('crop-summary')).toHaveText('1 page will be cropped.')
    const { bytes } = await runAndDownload(page)
    const s0 = await visualSizes(fixtureBytes('rich.pdf'))
    const s1 = await visualSizes(bytes)
    expect(s1[0]).toEqual(s0[0])
    expect(s1[2][1]).toBeCloseTo(s0[2][1] - 30 * MM, 0)
  })
})

test.describe('Page numbers and watermark', () => {
  test('page numbers: prefix, Roman numerals, skip cover; live preview', async ({ page }) => {
    await page.goto('/add-page-numbers')
    await upload(page, 'text-8p.pdf')
    await page.getByTestId('pn-prefix').fill('p. ')
    await page.getByTestId('pn-style').selectOption('roman')
    await page.getByTestId('pn-skip').check()
    await expect(page.getByTestId('label-preview')).toHaveText('This page is not numbered.')
    await page.getByRole('button', { name: 'Next page' }).click()
    await expect(page.getByTestId('label-preview')).toHaveText('This page: “p. I”')
    await expect(page.getByTestId('live-preview').locator('canvas')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('pn-summary')).toHaveText('7 pages will be numbered.')
    const { bytes, name } = await runAndDownload(page)
    expect(name).toBe('text-8p-numbered.pdf')
    const t = await pageTexts(bytes)
    expect(t[0]).not.toContain('p. ')
    expect(t[1]).toContain('p. I')
    expect(t[7]).toContain('p. VII')
  })

  test('page numbers in Arabic numerals with an Arabic prefix (Arabic UI)', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('freepdf:lang', 'ar'))
    await page.goto('/add-page-numbers')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await upload(page, 'arabic.pdf')
    await page.getByTestId('pn-prefix').fill('صفحة ')
    await page.getByTestId('pn-style').selectOption('arabic-indic')
    await expect(page.getByTestId('label-preview')).toHaveText('هذه الصفحة: «صفحة ١»')
    const { bytes } = await runAndDownload(page)
    const t = await pageTexts(bytes)
    expect(t[0]).toContain('صفحة')
    expect(t[2]).toContain('٣')
  })

  test('text watermark, tiled, behind content, on selected pages', async ({ page }) => {
    await page.goto('/watermark-pdf')
    await upload(page, 'text-8p.pdf')
    await expect(page.getByTestId('run')).toBeDisabled()
    await page.getByTestId('wm-text').fill('DRAFT')
    await page.getByText('Tiled', { exact: true }).click()
    await page.getByText('Behind the content', { exact: true }).click()
    await page.getByTestId('ranges').fill('2-3')
    await expect(page.getByTestId('live-preview').locator('canvas')).toBeVisible({ timeout: 20_000 })
    const { bytes, name } = await runAndDownload(page)
    expect(name).toBe('text-8p-watermarked.pdf')
    const t = await pageTexts(bytes)
    expect(t[0]).not.toContain('DRAFT')
    expect(t[1].split('DRAFT').length - 1).toBeGreaterThan(4)
    expect(qpdfCheck(bytes)).toBe(true)
  })

  test('image watermark with a PNG', async ({ page }) => {
    await page.goto('/watermark-pdf')
    await upload(page, 'text-8p.pdf')
    await page.getByText('Image', { exact: true }).click()
    await page.getByTestId('file-input').last().setInputFiles('tests/fixtures/alpha.png')
    await page.getByTestId('anchor-br').click()
    await expect(page.getByTestId('run')).toBeEnabled()
    const { bytes } = await runAndDownload(page)
    const doc = await PDFDocument.load(bytes)
    const xo = doc.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict)
    expect(xo.entries().length).toBeGreaterThan(0)
  })
})
