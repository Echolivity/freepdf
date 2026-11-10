import { expect, test } from '@playwright/test'
import { guardPage } from './helpers'

test('homepage lists only working tools, searches, and toggles theme', async ({ page }) => {
  const g = guardPage(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Every PDF tool you need. Completely free.')
  await expect(page.getByRole('link', { name: /Merge PDF/ })).toBeVisible()
  await page.getByLabel('Search tools').fill('combine')
  await expect(page.getByText('1 tool found')).toBeVisible()
  await page.getByLabel('Search tools').fill('zzzz')
  await expect(page.getByText('No tools match')).toBeVisible()
  await page.getByLabel('Search tools').fill('')

  const html = page.locator('html')
  const wasDark = await html.evaluate((el) => el.classList.contains('dark'))
  await page.getByRole('button', { name: /Switch to (dark|light) theme/ }).click()
  await expect(html).toHaveClass(wasDark ? /^(?!.*dark)/ : /dark/)
  g.assertClean()
})

test('every tool card opens a working tool page with a drop zone', async ({ page }) => {
  const g = guardPage(page)
  await page.goto('/')
  const hrefs = await page.locator('main a[href^="/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href')!))].filter((h) => h !== '/' && h !== '/privacy'))
  expect(hrefs.length).toBeGreaterThanOrEqual(11)
  for (const href of hrefs) {
    await page.goto(href)
    await expect(page.getByRole('button', { name: /^Select (PDF|image) files?$/ })).toBeVisible()
  }
  g.assertClean()
})

test('recently used tools are remembered locally', async ({ page }) => {
  await page.goto('/rotate-pdf')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Recently used' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(page.getByRole('heading', { name: 'Recently used' })).toHaveCount(0)
})

test('unknown routes show a 404 page', async ({ page }) => {
  await page.goto('/does-not-exist')
  await expect(page.getByText("This page doesn't exist")).toBeVisible()
})
