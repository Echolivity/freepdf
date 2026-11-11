import { test, expect } from './fixtures'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { upload } from './helpers'

const ROUTES = ['/', '/merge-pdf', '/organize-pdf', '/compress-pdf', '/pdf-to-jpg', '/jpg-to-pdf', '/resize-pdf', '/compare-pdf', '/crop-pdf', '/add-page-numbers', '/watermark-pdf', '/extract-pdf', '/delete-pages', '/privacy']

for (const lang of ['en', 'ar'] as const) {
  test(`no horizontal overflow on any page (${lang})`, async ({ page }) => {
    await page.addInitScript((l) => localStorage.setItem('freepdf:lang', l), lang)
    for (const r of ROUTES) {
      await page.goto(r)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      // On failure, name the elements that stick out so the cause is visible in the CI log.
      const culprits = overflow > 1 ? await page.evaluate(() => [...document.querySelectorAll('body *')]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1))
        .slice(0, 8)
        .map(({ el, r }) => `<${el.tagName.toLowerCase()} class="${el.getAttribute('class') ?? ''}"> ${Math.round(r.left)}..${Math.round(r.right)} "${(el.textContent ?? '').trim().slice(0, 40)}"`)) : []
      expect(overflow, `${r} overflows by ${overflow}px (innerWidth ${page.viewportSize()?.width}): ${culprits.join(' ; ')}`).toBeLessThanOrEqual(1)
    }
  })
}

test('header controls stay reachable on every width', async ({ page }) => {
  await page.goto('/')
  for (const id of ['lang-toggle', 'theme-toggle']) await expect(page.getByTestId(id)).toBeInViewport()
  await expect(page.getByRole('link', { name: 'FreePDF home' })).toBeInViewport()
})

test('page thumbnails and their controls fit (organize, Arabic)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('freepdf:lang', 'ar'))
  await page.goto('/organize-pdf')
  await upload(page, 'rich.pdf')
  const first = page.getByRole('list', { name: 'الصفحات' }).getByRole('listitem').first()
  await expect(first).toBeVisible()
  for (const name of ['تدوير الصفحة 1', 'حذف الصفحة 1']) {
    const box = await page.getByRole('button', { name }).boundingBox()
    const tile = await first.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(tile!.x - 1)
    expect(box!.x + box!.width).toBeLessThanOrEqual(tile!.x + tile!.width + 1)
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('low-memory devices get the lower limits, stated before processing', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'deviceMemory', { value: 2 }))
  await page.goto('/merge-pdf')
  await expect(page.getByText('up to 100 MB per file, 200 MB per job')).toBeVisible()
  // A 110 MB file is refused up front with the reason, instead of crashing the tab later.
  const dir = mkdtempSync(join(tmpdir(), 'freepdf-'))
  const big = join(dir, 'big-scan.pdf')
  const buf = Buffer.alloc(110 * 1024 * 1024, 0x20)
  buf.write('%PDF-1.7\n')
  writeFileSync(big, buf)
  await page.getByTestId('file-input').setInputFiles(big)
  await expect(page.getByRole('alert')).toContainText('“big-scan.pdf” is 110 MB. The limit per file is 100 MB')
  await page.goto('/privacy')
  await expect(page.getByTestId('device-limits')).toHaveText('This device uses the phone / low-memory limits.')
})
