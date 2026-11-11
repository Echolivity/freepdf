import { test, expect } from './fixtures'
type Page = import('@playwright/test').Page
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

// Round 2: the full a11y sequence (init script → home → privacy → split → upload), one step left out each time.
const animationsDone = (page: Page) =>
  page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity))
async function sequence(page: Page, o: { init?: boolean; home?: boolean; privacy?: boolean; axe?: boolean; wait?: boolean }) {
  if (o.init !== false) await page.addInitScript(() => { localStorage.setItem('freepdf:lang', 'en'); localStorage.setItem('freepdf:theme', 'light') })
  const audit = async () => { if (o.wait !== false) await animationsDone(page); if (o.axe !== false) await axe(page) }
  if (o.home !== false) { await page.goto('/'); await audit() }
  if (o.privacy !== false) { await page.goto('/privacy'); await audit() }
  await page.goto('/split-pdf')
  await audit()
  await page.getByTestId('file-input').first().setInputFiles(fx('rich.pdf'))
  await thumb(page)
}
test('G0 full sequence (control)', async ({ page }) => { await run(page, 'G0', () => sequence(page, {})) })
test('G1 without the init script', async ({ page }) => { await run(page, 'G1', () => sequence(page, { init: false })) })
test('G2 without the home step', async ({ page }) => { await run(page, 'G2', () => sequence(page, { home: false })) })
test('G3 without the privacy step', async ({ page }) => { await run(page, 'G3', () => sequence(page, { privacy: false })) })
test('G4 without axe', async ({ page }) => { await run(page, 'G4', () => sequence(page, { axe: false })) })
test('G5 without the animation wait', async ({ page }) => { await run(page, 'G5', () => sequence(page, { wait: false })) })
test('G6 privacy page then split, no axe, no init', async ({ page }) => { await run(page, 'G6', () => sequence(page, { init: false, home: false, axe: false, wait: false })) })
