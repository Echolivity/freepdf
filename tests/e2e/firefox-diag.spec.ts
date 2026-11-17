import { test, expect } from './fixtures'
import AxeBuilder from '@axe-core/playwright'
import { upload, runAndDownload } from './helpers'

// Temporary diagnostics: which axe rule crashes Firefox's content process on the Merge result screen in CI?
// Runs only with FIREFOX_DIAG=1. Each case gets a fresh page.
test.skip(!process.env.FIREFOX_DIAG, 'diagnostics only')

const RULES = ['area-alt', 'aria-allowed-attr', 'aria-braille-equivalent', 'aria-command-name', 'aria-conditional-attr', 'aria-deprecated-role', 'aria-hidden-body', 'aria-hidden-focus', 'aria-input-field-name', 'aria-meter-name', 'aria-progressbar-name', 'aria-prohibited-attr', 'aria-required-attr', 'aria-required-children', 'aria-required-parent', 'aria-roledescription', 'aria-roles', 'aria-tab-name', 'aria-toggle-field-name', 'aria-tooltip-name', 'aria-valid-attr-value', 'aria-valid-attr', 'audio-caption', 'autocomplete-valid', 'avoid-inline-spacing', 'blink', 'button-name', 'bypass', 'color-contrast', 'css-orientation-lock', 'definition-list', 'dlitem', 'document-title', 'duplicate-id-aria', 'form-field-multiple-labels', 'frame-focusable-content', 'frame-title-unique', 'frame-title', 'html-has-lang', 'html-lang-valid', 'html-xml-lang-mismatch', 'image-alt', 'input-button-name', 'input-image-alt', 'label-content-name-mismatch', 'label', 'link-in-text-block', 'link-name', 'list', 'listitem', 'marquee', 'meta-refresh', 'meta-viewport', 'nested-interactive', 'no-autoplay-audio', 'object-alt', 'p-as-heading', 'role-img-alt', 'scrollable-region-focusable', 'select-name', 'server-side-image-map', 'summary-name', 'svg-img-alt', 'table-fake-caption', 'td-has-header', 'td-headers-attr', 'th-has-data-cells', 'valid-lang', 'video-caption']

const CASES: [string, string[] | 'none' | 'all'][] = [['control-no-axe', 'none'], ['control-all-rules', 'all'], ...RULES.map((r) => [r, [r]] as [string, string[]])]
for (const [label, rules] of CASES) {
  test(`axe rule ${label}`, async ({ page }) => {
    let crashed = false
    page.on('crash', () => { crashed = true })
    await page.goto('/merge-pdf')
    await upload(page, 'text-8p.pdf', 'signed.pdf')
    await runAndDownload(page)
    await page.waitForTimeout(1000)
    let outcome = 'ok'
    try {
      if (rules === 'all') await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
      else if (rules !== 'none') await new AxeBuilder({ page }).withRules(rules).analyze()
      await page.evaluate(() => document.title)
    } catch (e) {
      outcome = `error: ${(e as Error).message.split('\n')[0]}`
    }
    console.log(`DIAG ${label}: ${crashed ? 'CRASHED' : outcome}`)
    expect(crashed).toBe(false)
  })
}
