// Captures desktop and mobile screenshots of given tools in English and Arabic, for release reports.
// Usage: npm run build && (npm run preview &) && node qa/screenshots.mjs out-dir
import { chromium, devices } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const BASE = process.env.BASE || 'http://localhost:4173'
const out = process.argv[2] || 'qa/screenshots'
mkdirSync(out, { recursive: true })
const fx = (n) => readFileSync(join('tests/fixtures', n))

async function textPdf(pages) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const lines of pages) {
    const p = doc.addPage([595, 842])
    lines.forEach((l, i) => p.drawText(l, { x: 50, y: 780 - i * 22, size: 13, font }))
  }
  return Buffer.from(await doc.save())
}
const v1 = await textPdf([['Payment is due within 30 days of the invoice date.', 'The supplier delivers monthly.', 'Either party may terminate with notice.']])
const v2 = await textPdf([['Payment is due within 45 days of the invoice date.', 'The supplier delivers monthly.', 'Either party may terminate with 60 days notice.']])

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
for (const [dev, opts] of [['desktop', { viewport: { width: 1360, height: 900 } }], ['mobile', devices['Pixel 7']]]) {
  for (const lang of ['en', 'ar']) {
    const ctx = await browser.newContext(opts)
    await ctx.addInitScript((l) => localStorage.setItem('freepdf:lang', l), lang)
    const page = await ctx.newPage()
    await page.goto(`${BASE}/resize-pdf`)
    await page.getByTestId('file-input').setInputFiles({ name: lang === 'ar' ? 'تقرير.pdf' : 'report.pdf', mimeType: 'application/pdf', buffer: fx('rich.pdf') })
    await page.getByTestId('rs-size').selectOption('letter')
    await page.getByTestId('resize-preview').waitFor()
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(out, `resize-${dev}-${lang}.png`), fullPage: true })
    await page.goto(`${BASE}/compare-pdf`)
    await page.getByTestId('file-input').setInputFiles([
      { name: 'contract-v1.pdf', mimeType: 'application/pdf', buffer: v1 },
      { name: 'contract-v2.pdf', mimeType: 'application/pdf', buffer: v2 },
    ])
    await page.getByTestId('run').click()
    await page.getByTestId('cmp-stats').waitFor()
    await page.getByRole('img').first().waitFor()
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(out, `compare-${dev}-${lang}.png`), fullPage: true })
    await page.locator('label').filter({ hasText: lang === 'ar' ? 'طبقة الفروق' : 'Difference overlay' }).click()
    await page.getByTestId('cmp-ratio').filter({ hasText: '%' }).waitFor()
    await page.screenshot({ path: join(out, `compare-overlay-${dev}-${lang}.png`), fullPage: true })

    // v1.2.0 tools
    await page.goto(`${BASE}/`)
    await page.screenshot({ path: join(out, `home-${dev}-${lang}.png`), fullPage: false })
    await page.goto(`${BASE}/crop-pdf`)
    await page.getByTestId('file-input').setInputFiles({ name: 'report.pdf', mimeType: 'application/pdf', buffer: fx('text-8p.pdf') })
    await page.getByTestId('crop-top').fill('25')
    await page.getByTestId('crop-left').fill('15')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: join(out, `crop-${dev}-${lang}.png`), fullPage: true })
    await page.goto(`${BASE}/add-page-numbers`)
    await page.getByTestId('file-input').setInputFiles({ name: 'contract.pdf', mimeType: 'application/pdf', buffer: fx(lang === 'ar' ? 'arabic.pdf' : 'text-8p.pdf') })
    await page.getByTestId('pn-prefix').fill(lang === 'ar' ? 'صفحة ' : 'Page ')
    if (lang === 'ar') await page.getByTestId('pn-style').selectOption('arabic-indic')
    await page.getByTestId('live-preview').locator('canvas').waitFor()
    await page.waitForTimeout(1200)
    await page.screenshot({ path: join(out, `page-numbers-${dev}-${lang}.png`), fullPage: true })
    await page.goto(`${BASE}/watermark-pdf`)
    await page.getByTestId('file-input').setInputFiles({ name: 'contract.pdf', mimeType: 'application/pdf', buffer: fx('text-8p.pdf') })
    await page.getByTestId('wm-text').fill(lang === 'ar' ? 'مسودة' : 'DRAFT')
    await page.locator('label').filter({ hasText: lang === 'ar' ? 'مكررة' : 'Tiled' }).click()
    await page.getByTestId('live-preview').locator('canvas').waitFor()
    await page.waitForTimeout(1500)
    await page.screenshot({ path: join(out, `watermark-${dev}-${lang}.png`), fullPage: true })
    await page.goto(`${BASE}/organize-pdf`)
    await page.getByTestId('file-input').setInputFiles({ name: 'contract.pdf', mimeType: 'application/pdf', buffer: fx('text-8p.pdf') })
    await page.getByTestId('file-input').last().setInputFiles({ name: 'annex.pdf', mimeType: 'application/pdf', buffer: fx('rich.pdf') })
    await page.getByRole('checkbox').nth(2).check()
    await page.waitForTimeout(1500)
    await page.screenshot({ path: join(out, `organize-${dev}-${lang}.png`), fullPage: true })
    await ctx.close()
  }
}
await browser.close()
console.log('screenshots →', out)
