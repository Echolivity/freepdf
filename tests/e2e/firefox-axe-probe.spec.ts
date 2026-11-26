import { test, type Page } from './fixtures'
import AxeBuilder from '@axe-core/playwright'
import { upload, runAndDownload } from './helpers'

// Diagnostic, Firefox only, never fails: runs each axe rule that the accessibility sweep disables in
// Firefox on its own, in a fresh page, on each key screen, and prints whether it ran or crashed:
//   PROBE <rule> <screen> ok|crash: <message>
// Rules that run cleanly everywhere can then be turned back on in a11y.spec.ts.
const RULES = ['aria-allowed-attr', 'aria-conditional-attr', 'aria-prohibited-attr', 'label-content-name-mismatch', 'nested-interactive']

const SCREENS: [string, (page: Page) => Promise<void>][] = [
  ['home', async (p) => { await p.goto('/') }],
  ['tool-with-file', async (p) => { await p.goto('/split-pdf'); await upload(p, 'rich.pdf'); await p.getByRole('list').nth(1).waitFor({ state: 'visible' }) }],
  ['merge-result', async (p) => { await p.goto('/merge-pdf'); await upload(p, 'text-8p.pdf', 'signed.pdf'); await runAndDownload(p) }],
  ['fill-form', async (p) => { await p.goto('/fill-pdf-form'); await upload(p, 'forms/application.pdf'); await p.getByTestId('fs-summary').waitFor() }],
  ['redact', async (p) => { await p.goto('/redact-pdf'); await upload(p, 'redact/letter.pdf'); await p.getByTestId('rd-summary').waitFor() }],
]

test.describe('Firefox axe probe', () => {
  test.skip(({ browserName }) => browserName !== 'firefox', 'Firefox only')
  test.describe.configure({ timeout: 600_000 })

  test('which disabled rules run cleanly in Firefox', async ({ context }) => {
    const results: string[] = []
    for (const [screen, open] of SCREENS) {
      for (const rule of RULES) {
        const page = await context.newPage()
        let crashed = false
        page.on('crash', () => { crashed = true })
        let outcome: string
        try {
          await open(page)
          await new AxeBuilder({ page }).withRules([rule]).analyze()
          outcome = crashed ? 'crash: page crashed' : 'ok'
        } catch (e) {
          outcome = `crash: ${crashed ? 'page crashed' : String((e as Error).message).split('\n')[0].slice(0, 160)}`
        }
        const line = `PROBE ${rule} ${screen} ${outcome}`
        console.log(line)
        results.push(line)
        await page.close().catch(() => {})
      }
    }
    test.info().annotations.push({ type: 'probe', description: results.join('\n') })
  })
})
