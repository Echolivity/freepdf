import { test, expect } from './fixtures'
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { upload } from './helpers'

/** A complete job on every device profile: choose files, set an option, process, download, start over. */
test('merge with mixed Arabic/English file names works end to end', async ({ page }) => {
  await page.goto('/merge-pdf')
  await page.getByTestId('file-input').setInputFiles([
    { name: 'تقرير Q3 final.pdf', mimeType: 'application/pdf', buffer: readFileSync(new URL('../fixtures/arabic.pdf', import.meta.url)) },
    { name: 'appendix ملحق.pdf', mimeType: 'application/pdf', buffer: readFileSync(new URL('../fixtures/text-8p.pdf', import.meta.url)) },
  ])
  await expect(page.getByRole('list', { name: 'Selected files' }).getByRole('listitem')).toHaveCount(2)
  await page.getByTestId('run').click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()])
  expect(dl.suggestedFilename()).toBe('تقرير Q3 final-merged.pdf')
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
