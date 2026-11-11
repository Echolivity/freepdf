import { test, expect } from './fixtures'
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { upload, expectedDownloadName } from './helpers'

/** A complete job on every device profile: choose files, set an option, process, download, start over. */
test('merge with mixed Arabic/English file names works end to end', async ({ page, browserName }) => {
  await page.goto('/merge-pdf')
  await page.getByTestId('file-input').setInputFiles([
    { name: 'تقرير Q3 final.pdf', mimeType: 'application/pdf', buffer: readFileSync(new URL('../fixtures/arabic.pdf', import.meta.url)) },
    { name: 'appendix ملحق.pdf', mimeType: 'application/pdf', buffer: readFileSync(new URL('../fixtures/text-8p.pdf', import.meta.url)) },
  ])
  await expect(page.getByRole('list', { name: 'Selected files' }).getByRole('listitem')).toHaveCount(2)
  await page.getByTestId('run').click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()])
  expect(dl.suggestedFilename()).toBe(expectedDownloadName('تقرير Q3 final-merged.pdf', browserName))
  expect((await PDFDocument.load(readFileSync((await dl.path())!))).getPageCount()).toBe(11)
  await page.getByTestId('start-over').click()
  await expect(page.getByRole('button', { name: 'Select PDF files' })).toBeVisible()
})

test('PDF to JPG on a phone-sized screen', async ({ page }) => {
  await page.goto('/pdf-to-jpg')
  await upload(page, 'arabic.pdf')
  await page.getByText('72 DPI').click()
  await page.getByTestId('run').click()
  await expect(page.getByTestId('download-zip')).toBeVisible({ timeout: 60_000 })
})

test('resize and compare on a touch screen', async ({ page }) => {
  await page.goto('/resize-pdf')
  await upload(page, 'rich.pdf')
  await page.getByTestId('rs-size').selectOption('a4')
  await page.getByTestId('run').click()
  await expect(page.getByTestId('download')).toBeVisible({ timeout: 60_000 })
  await page.goto('/compare-pdf')
  await upload(page, 'text-8p.pdf', 'structured.pdf')
  await page.getByTestId('run').click()
  await expect(page.getByTestId('cmp-stats')).toBeVisible({ timeout: 60_000 })
  await page.getByTestId('cmp-pages').getByRole('button').first().click()
  await page.locator('label').filter({ hasText: 'Difference overlay' }).click()
  await expect(page.getByTestId('cmp-ratio')).toContainText('%', { timeout: 30_000 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

/** Pointer events as a finger produces them (pointerType "touch"). */
async function touchDrag(from: import('@playwright/test').Locator, dx: number, dy: number, to?: import('@playwright/test').Locator) {
  const a = (await from.boundingBox())!
  const sx = a.x + a.width / 2
  const sy = a.y + a.height / 2
  let ex = sx + dx
  let ey = sy + dy
  if (to) { const b = (await to.boundingBox())!; ex = b.x + b.width / 2; ey = b.y + b.height / 2 }
  const base = { pointerId: 3, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, bubbles: true }
  await from.dispatchEvent('pointerdown', { ...base, clientX: sx, clientY: sy })
  for (let i = 1; i <= 5; i++) await from.dispatchEvent('pointermove', { ...base, clientX: sx + ((ex - sx) * i) / 5, clientY: sy + ((ey - sy) * i) / 5 })
  await from.dispatchEvent('pointerup', { ...base, buttons: 0, clientX: ex, clientY: ey })
}

test('touch: reorder pages by dragging the grip, and drag a crop edge', async ({ page }) => {
  await page.goto('/organize-pdf')
  await upload(page, 'text-8p.pdf')
  const tiles = page.getByRole('list', { name: 'Pages' }).getByRole('listitem')
  await tiles.nth(1).scrollIntoViewIfNeeded()
  await touchDrag(page.getByTestId('grip-0'), 0, 0, tiles.nth(1))
  await expect(tiles.nth(0)).toContainText('2')
  await expect(tiles.nth(1)).toContainText('1')

  await page.goto('/crop-pdf')
  await upload(page, 'text-8p.pdf')
  const handle = page.getByTestId('crop-handle-top')
  await handle.scrollIntoViewIfNeeded()
  await touchDrag(handle, 0, 40)
  await expect.poll(async () => Number(await page.getByTestId('crop-top').inputValue())).toBeGreaterThan(5)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
