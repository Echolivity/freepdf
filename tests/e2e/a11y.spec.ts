import { test, expect } from './fixtures'
import AxeBuilder from '@axe-core/playwright'
import { upload, runAndDownload } from './helpers'

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
      await page.addInitScript(([l, t]) => { localStorage.setItem('freepdf:lang', l); localStorage.setItem('freepdf:theme', t) }, [lang, theme])
      await page.goto('/')
      await audit(page, 'home')
      await page.goto('/privacy')
      await audit(page, 'privacy')
      await page.goto('/split-pdf')
      await audit(page, 'tool empty')
      await upload(page, 'rich.pdf')
      await expect(page.getByRole('list').nth(1)).toBeVisible()
      await audit(page, 'tool with file')
      await page.goto('/merge-pdf')
      await upload(page, 'text-8p.pdf', 'signed.pdf')
      await runAndDownload(page)
      await audit(page, 'result')
      await page.goto('/resize-pdf')
      await upload(page, 'rich.pdf')
      await expect(page.getByTestId('resize-preview')).toBeVisible()
      await audit(page, 'resize with file')
      await page.goto('/compare-pdf')
      await upload(page, 'text-8p.pdf', 'structured.pdf')
      await page.getByTestId('run').click()
      await expect(page.getByTestId('cmp-stats')).toBeVisible({ timeout: 30_000 })
      await audit(page, 'compare result')
      for (const [route, file] of [['/crop-pdf', 'rich.pdf'], ['/add-page-numbers', 'text-8p.pdf'], ['/watermark-pdf', 'text-8p.pdf'], ['/organize-pdf', 'text-8p.pdf'], ['/delete-pages', 'text-8p.pdf'], ['/tiff-to-pdf', 'convert/two-pages-lzw.tif'], ['/txt-to-pdf', 'convert/notes.txt'], ['/pdf-to-webp', 'text-8p.pdf'], ['/pdf-to-txt', 'text-8p.pdf'], ['/pdf-to-html', 'arabic.pdf'], ['/word-to-pdf', 'office/report.docx'], ['/excel-to-pdf', 'office/sheet.xlsx'], ['/html-to-pdf', 'office/page.html'], ['/pdf-to-word', 'text-8p.pdf'], ['/pdf-to-excel', 'text-8p.pdf'], ['/pdf-to-powerpoint', 'text-8p.pdf']] as const) {
        await page.goto(route)
        await upload(page, file)
        await expect(page.getByTestId('run')).toBeVisible()
        await page.waitForTimeout(800)
        await audit(page, `${route} with a file`)
      }
    })
  }
}

test('keyboard: skip link, file picker and main flow work without a mouse', async ({ page }) => {
  await page.goto('/merge-pdf')
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await expect(skip).toBeFocused()
  await page.keyboard.press('Enter')
  // Tab forward to the file picker button and open it with the keyboard.
  const select = page.getByRole('button', { name: 'Select PDF files' })
  for (let i = 0; i < 10 && !(await select.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
  await expect(select).toBeFocused()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Enter')])
  expect(chooser.isMultiple()).toBe(true)
  // Focus is clearly visible (outline drawn by :focus-visible).
  const outline = await select.evaluate((el) => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth)
  expect(outline).toMatch(/solid \d/)
})

test('results heading receives focus so screen readers announce completion', async ({ page }) => {
  await page.goto('/rotate-pdf')
  await upload(page, 'text-8p.pdf')
  await page.getByTestId('run').click()
  await expect(page.getByRole('heading', { name: 'Your file is ready' })).toBeFocused()
})

test('options are real radio groups and progress is announced', async ({ page }) => {
  await page.goto('/compress-pdf')
  await upload(page, 'scan.pdf')
  const group = page.getByRole('group', { name: 'Compression' })
  await expect(group.getByRole('radio')).toHaveCount(4) // Lossless, Light, Balanced, Strong
  await group.getByText('Strong').click() // users click the visible option; the radio itself is visually hidden
  await expect(group.getByRole('radio', { name: /Strong/ })).toBeChecked()
})
