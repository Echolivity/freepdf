import { expect, test, type Page } from './fixtures'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { upload } from './helpers'

test.use({ locale: 'ar-SA' })

/** Words allowed to stay Latin in the Arabic UI: brand, formats, units, sizes, file names. */
const ALLOWED = /\b(FreePDF|PDFs?|JPE?G|PNGs?|WebP|ZIP|KB|MB|GB|A4|Letter|English|CSP|Web|Workers?|JavaScript|Word|Excel|PowerPoint|Shift|DPI|N)\b|[\w-]+\.(pdf|png|jpe?g|webp|zip)/gi

async function assertNoEnglish(page: Page) {
  const text = await page.locator('body').innerText()
  const leftovers = (text.replace(ALLOWED, ' ').match(/[A-Za-z]{3,}/g) ?? []).filter((w) => !/^(Section|Page|Contract|reference)$/.test(w))
  expect(leftovers, `Untranslated text: ${leftovers.join(', ')}`).toEqual([])
}

test('Arabic browsers get the Arabic, right-to-left interface by default', async ({ page }) => {
  await page.goto('/')
  const html = page.locator('html')
  await expect(html).toHaveAttribute('dir', 'rtl')
  await expect(html).toHaveAttribute('lang', 'ar')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('أدوات PDF خاصة. ملفاتك تبقى على جهازك.')
  await expect(page).toHaveTitle('FreePDF — أدوات PDF خاصة. ملفاتك تبقى على جهازك.')
  await assertNoEnglish(page)
})

test('language switch works both ways and is remembered', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('lang-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Private PDF tools. Your files stay on your device.')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.getByTestId('lang-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
})

test('Arabic search finds tools', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('ابحث في الأدوات').fill('دمج')
  await expect(page.getByRole('link', { name: /دمج PDF/ })).toBeVisible()
  await expect(page.getByText('أداة واحدة')).toBeVisible()
})

test('merge in Arabic: translated validation, progress and result, no English left', async ({ page }) => {
  await page.goto('/merge-pdf')
  await assertNoEnglish(page)
  await upload(page, 'arabic.pdf', 'text-8p.pdf', 'not-a-pdf.pdf')
  // File names and format names are wrapped in Unicode isolates so they don't scramble RTL text.
  await expect(page.getByRole('alert')).toContainText(/ليس بصيغة\s*\u2068?PDF/)
  await assertNoEnglish(page)
  await page.getByTestId('run').click()
  await expect(page.getByRole('heading', { name: 'ملفك جاهز' })).toBeVisible()
  await assertNoEnglish(page)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()])
  expect((await PDFDocument.load(readFileSync((await dl.path())!))).getPageCount()).toBe(11)
})

test('engine errors arrive in Arabic (encrypted file)', async ({ page }) => {
  await page.goto('/merge-pdf')
  await upload(page, 'text-8p.pdf', 'encrypted-user.pdf')
  await page.getByTestId('run').click()
  await expect(page.getByRole('alert')).toContainText('محمي بكلمة مرور')
})

test('split accepts Arabic-Indic digits and the Arabic comma', async ({ page }) => {
  await page.goto('/split-pdf')
  await upload(page, 'arabic.pdf')
  await page.getByTestId('ranges').fill('١-٢، ٣')
  await expect(page.getByTestId('plan')).toHaveText('سيُنشأ ملفا PDF، ويمكن تنزيلهما في ملف ZIP.')
  await page.getByTestId('run').click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-zip').click()])
  const zip = await JSZip.loadAsync(readFileSync((await dl.path())!))
  expect(Object.keys(zip.files).sort()).toEqual(['arabic-page-3.pdf', 'arabic-pages-1-2.pdf'])
  await assertNoEnglish(page)
})

test('Arabic file names are preserved in downloads', async ({ page }) => {
  await page.goto('/remove-pages')
  await page.getByTestId('file-input').setInputFiles({ name: 'عقد إيجار.pdf', mimeType: 'application/pdf', buffer: readFileSync(new URL('../fixtures/arabic.pdf', import.meta.url)) })
  await page.getByTestId('ranges').fill('٣')
  await page.getByTestId('run').click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()])
  expect(dl.suggestedFilename()).toBe('عقد إيجار-edited.pdf')
})

test('organize controls are mirrored and still move pages in reading order', async ({ page }) => {
  await page.goto('/organize-pdf')
  await upload(page, 'arabic.pdf')
  await page.getByRole('button', { name: 'تقديم الصفحة 3' }).click()
  await expect(page.getByRole('list', { name: 'الصفحات' }).getByRole('listitem').nth(1)).toContainText('3')
  await page.getByTestId('run').click()
  await expect(page.getByRole('heading', { name: 'ملفك جاهز' })).toBeVisible()
})
