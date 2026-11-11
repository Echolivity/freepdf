import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { join } from 'node:path'

// Temporary diagnostics for the Firefox page crash seen only in CI (a11y.spec on /split-pdf with
// rich.pdf). Runs only with FIREFOX_DIAG=1; each case changes one variable and reports what happened.
test.skip(!process.env.FIREFOX_DIAG, 'diagnostics only')
test.describe.configure({ mode: 'serial', retries: 0 })

const fx = (n: string) => join(process.cwd(), 'tests/fixtures', n)
const axe = (page: Page, o: { only?: string[]; without?: string[] } = {}) => {
  let b = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  if (o.only) b = new AxeBuilder({ page }).withRules(o.only)
  if (o.without) b = b.disableRules(o.without)
  return b.analyze()
}

async function run(page: Page, label: string, steps: () => Promise<void>) {
  let crashed = false
  page.on('crash', () => { crashed = true })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  let outcome = 'ok'
  try {
    await steps()
    await page.waitForTimeout(1500)
    await page.evaluate(() => document.title)
  } catch (e) {
    outcome = `error: ${(e as Error).message.split('\n')[0]}`
  }
  console.log(`DIAG ${label}: ${crashed ? 'CRASHED' : outcome}${errors.length ? ` | pageerrors: ${errors.join(' ; ')}` : ''}`)
  expect(crashed).toBe(false)
}

const thumb = (page: Page) => page.getByRole('list').nth(1).waitFor({ timeout: 15000 })

test('E1 split + rich.pdf, no axe', async ({ page }) => {
  await run(page, 'E1', async () => { await page.goto('/split-pdf'); await page.getByTestId('file-input').first().setInputFiles(fx('rich.pdf')); await thumb(page) })
})
test('E2 axe, then split + text-8p.pdf', async ({ page }) => {
  await run(page, 'E2', async () => { await page.goto('/split-pdf'); await axe(page); await page.getByTestId('file-input').first().setInputFiles(fx('text-8p.pdf')); await thumb(page) })
})
test('E3 axe, then split + rich.pdf (the CI failure)', async ({ page }) => {
  await run(page, 'E3', async () => { await page.goto('/split-pdf'); await axe(page); await page.getByTestId('file-input').first().setInputFiles(fx('rich.pdf')); await thumb(page) })
})
test('E4 split + rich.pdf, then axe', async ({ page }) => {
  await run(page, 'E4', async () => { await page.goto('/split-pdf'); await page.getByTestId('file-input').first().setInputFiles(fx('rich.pdf')); await thumb(page); await page.waitForTimeout(1500); await axe(page) })
})
test('E5 axe, then crop + rich.pdf', async ({ page }) => {
  await run(page, 'E5', async () => { await page.goto('/crop-pdf'); await axe(page); await page.getByTestId('file-input').first().setInputFiles(fx('rich.pdf')); await page.getByTestId('run').waitFor({ timeout: 15000 }) })
})
test('E6 axe colour-contrast only, then split + rich.pdf', async ({ page }) => {
  await run(page, 'E6', async () => { await page.goto('/split-pdf'); await axe(page, { only: ['color-contrast'] }); await page.getByTestId('file-input').first().setInputFiles(fx('rich.pdf')); await thumb(page) })
})
test('E7 axe without colour-contrast, then split + rich.pdf', async ({ page }) => {
  await run(page, 'E7', async () => { await page.goto('/split-pdf'); await axe(page, { without: ['color-contrast'] }); await page.getByTestId('file-input').first().setInputFiles(fx('rich.pdf')); await thumb(page) })
})
test('E8 axe on home, then split + rich.pdf', async ({ page }) => {
  await run(page, 'E8', async () => { await page.goto('/'); await axe(page); await page.goto('/split-pdf'); await page.getByTestId('file-input').first().setInputFiles(fx('rich.pdf')); await thumb(page) })
})
test('E9 axe, then split + structured.pdf', async ({ page }) => {
  await run(page, 'E9', async () => { await page.goto('/split-pdf'); await axe(page); await page.getByTestId('file-input').first().setInputFiles(fx('structured.pdf')); await thumb(page) })
})
test('E10 axe, wait 3 s, then split + rich.pdf', async ({ page }) => {
  await run(page, 'E10', async () => { await page.goto('/split-pdf'); await axe(page); await page.waitForTimeout(3000); await page.getByTestId('file-input').first().setInputFiles(fx('rich.pdf')); await thumb(page) })
})
