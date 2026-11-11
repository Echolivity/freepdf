import { test, expect } from './fixtures'
import AxeBuilder from '@axe-core/playwright'
test.skip(!process.env.FIREFOX_DIAG, 'diagnostics only')


/** Automated WCAG 2.1 AA checks (axe-core) in both languages, incl. colour contrast, in both themes. */
async function audit(page: import('@playwright/test').Page, label: string) {
  // Let entrance animations (e.g. the 220 ms fade-in of results) finish: axe measures contrast on the
  // current, half-transparent frame otherwise. Infinite animations (loading skeletons) are ignored.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity))
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(serious.map((v) => `${label}: ${v.id} — ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')})`)).toEqual([])
}

for (const lang of ['en', 'ar'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`WCAG AA: key screens (${lang}, ${theme})`, async ({ page }) => {
      page.on('crash', () => {}); page.on('pageerror', () => {})
      await page.addInitScript(([l, t]) => { localStorage.setItem('freepdf:lang', l); localStorage.setItem('freepdf:theme', t) }, [lang, theme])
      await page.goto('/')
      await audit(page, 'home')
      await page.goto('/privacy')
      await audit(page, 'privacy')
      await page.goto('/split-pdf')
      await audit(page, 'tool empty')
      await page.getByTestId('file-input').first().setInputFiles(process.cwd() + '/tests/fixtures/rich.pdf')
      await expect(page.getByRole('list').nth(1)).toBeVisible()
      await audit(page, 'tool with file')
    })
  }
}

