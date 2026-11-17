import { test, expect } from './fixtures'
import AxeBuilder from '@axe-core/playwright'
import { upload, runAndDownload } from './helpers'

// Temporary diagnostics: which axe rule crashes Firefox's content process on the Merge result screen in CI?
// Runs only with FIREFOX_DIAG=1. Each case gets a fresh page.
test.skip(!process.env.FIREFOX_DIAG, 'diagnostics only')

// Round 1 (all 69 rules one by one) found five that crash: aria-allowed-attr, aria-conditional-attr,
// aria-prohibited-attr, label-content-name-mismatch, nested-interactive.

// Round 2 (rule aria-allowed-attr, which crashes on its own): which part of the page, and which step?
type Step = 'uploaded' | 'result' | 'downloaded' | 'startedOver'
const CASES: [string, Step, string | null][] = [
  ['step uploaded', 'uploaded', null],
  ['step result (no download click)', 'result', null],
  ['step downloaded', 'downloaded', null],
  ['step started over', 'startedOver', null],
  ...(['body > :not(#root)', '#root', '[aria-live]', 'header', 'footer', 'main', '#main > div:nth-child(1)', '#main > div:nth-child(2)', 'section[aria-labelledby="result-h"]', '[data-testid="download"]', '[data-testid="start-over"]', '#result-h', 'section[aria-labelledby="about-h"]', 'section[aria-labelledby="faq-h"]', 'nav[aria-label="Breadcrumb"]'] as const).map((sel) => [`part ${sel}`, 'downloaded', sel] as [string, Step, string]),
]
for (const [label, step, include] of CASES) {
  test(`axe ${label}`, async ({ page }) => {
    let crashed = false
    page.on('crash', () => { crashed = true })
    await page.goto('/merge-pdf')
    await upload(page, 'text-8p.pdf', 'signed.pdf')
    if (step !== 'uploaded') {
      if (step === 'result') { await page.getByTestId('run').click(); await page.getByTestId('download').waitFor() }
      else await runAndDownload(page)
      if (step === 'startedOver') await page.getByTestId('start-over').click()
    }
    await page.waitForTimeout(1000)
    let outcome = 'ok'
    try {
      let b = new AxeBuilder({ page }).withRules(['aria-allowed-attr'])
      if (include) b = b.include(include)
      await b.analyze()
      await page.evaluate(() => document.title)
    } catch (e) {
      outcome = `error: ${(e as Error).message.split('\n')[0]}`
    }
    console.log(`DIAG ${label}: ${crashed ? 'CRASHED' : outcome}`)
    expect(crashed).toBe(false)
  })
}
