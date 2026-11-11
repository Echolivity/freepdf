import { test, expect } from './fixtures'
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { fixturePath, runAndDownload, upload } from './helpers'

/**
 * Instruments the page before the app loads: counts live FreePDF processing workers (ours only, not
 * PDF.js's), and tracks object URLs created/revoked. Optionally makes the first N processing workers
 * crash, to exercise the out-of-memory / worker-crash path for real (the app sees a genuine `error` event).
 */
async function instrument(page: import('@playwright/test').Page, opts: { crashFirst?: number } = {}) {
  await page.addInitScript((crashFirst: number) => {
    const w = window as unknown as { __fp: { live: number; created: number; urls: Set<string>; createdUrls: number } }
    w.__fp = { live: 0, created: 0, urls: new Set(), createdUrls: 0 }
    const Native = window.Worker
    const ours = (u: string | URL) => /\/pdf\.worker-[^/.]+\.js$/.test(String(u))
    window.Worker = class extends Native {
      constructor(url: string | URL, o?: WorkerOptions) {
        const crash = ours(url) && w.__fp.created < crashFirst
        // A worker script that fails to load fires the same `error` event a crashed/out-of-memory worker does.
        super(crash ? '/assets/pdf.worker-simulated-crash.js' : url, o)
        if (ours(url)) {
          w.__fp.created++
          w.__fp.live++
          const t = this.terminate.bind(this)
          let done = false
          this.terminate = () => { if (!done) { done = true; w.__fp.live-- } t() }
        }
      }
    } as typeof Worker
    const create = URL.createObjectURL.bind(URL)
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = (o: Blob | MediaSource) => { const u = create(o); w.__fp.urls.add(u); w.__fp.createdUrls++; return u }
    URL.revokeObjectURL = (u: string) => { w.__fp.urls.delete(u); revoke(u) }
  }, opts.crashFirst ?? 0)
}
const stats = (page: import('@playwright/test').Page) =>
  page.evaluate(() => { const s = (window as unknown as { __fp: { live: number; created: number; urls: Set<string>; createdUrls: number } }).__fp; return { live: s.live, created: s.created, openUrls: s.urls.size, createdUrls: s.createdUrls } })

test('signed and password-protected PDFs are flagged before processing', async ({ page }) => {
  await page.goto('/rotate-pdf')
  await upload(page, 'signed.pdf', 'encrypted-user.pdf')
  const warnings = page.getByTestId('file-warnings')
  await expect(warnings).toContainText('“signed.pdf” is digitally signed. Changing it makes that signature invalid')
  await expect(warnings).toContainText('“encrypted-user.pdf” is password-protected, so this tool can’t open it')
  await expect(page.getByText('Signed', { exact: true })).toBeVisible()
  // Certified documents get the stronger warning; empty signature fields get none.
  await page.goto('/delete-pages')
  await upload(page, 'certified.pdf')
  await expect(page.getByTestId('file-warnings')).toContainText('is certified by its author, who locked it against changes')
  await page.goto('/organize-pdf')
  await upload(page, 'sig-field.pdf')
  await expect(page.getByRole('list', { name: 'Pages' })).toBeVisible()
  await expect(page.getByTestId('file-warnings')).toHaveCount(0)
  // Read-only conversion doesn't warn about signatures (images carry none to break).
  await page.goto('/pdf-to-png')
  await upload(page, 'signed.pdf')
  await expect(page.getByTestId('file-warnings')).toHaveCount(0)
})

test('every job’s worker is terminated: after success, after cancel, and on repeat runs', async ({ page }) => {
  await instrument(page)
  await page.goto('/merge-pdf')
  for (let i = 0; i < 3; i++) {
    await upload(page, 'text-8p.pdf', 'scan.pdf')
    await runAndDownload(page)
    await page.getByTestId('start-over').click()
  }
  expect(await stats(page)).toMatchObject({ live: 0, created: 3 })

  await page.goto('/compress-pdf')
  await upload(page, 'compress/photos.pdf')
  await page.getByTestId('run').click()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('run')).toBeVisible()
  await expect.poll(async () => (await stats(page)).live).toBe(0)
  // ...and the tool still works afterwards.
  const { bytes } = await runAndDownload(page)
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3)
  await expect.poll(async () => (await stats(page)).live).toBe(0)
})

test('temporary files are released: previews on start over, downloads shortly after', async ({ page }) => {
  test.slow()
  await instrument(page)
  await page.goto('/jpg-to-pdf')
  await upload(page, 'photo.jpg', 'alpha.png', 'photo.webp') // image previews use object URLs
  await expect.poll(async () => (await stats(page)).openUrls).toBeGreaterThanOrEqual(3)
  await runAndDownload(page)
  await page.getByTestId('start-over').click()
  // Previews are revoked immediately; the download URL is kept 30 s so slow browsers can finish saving.
  await expect.poll(async () => (await stats(page)).openUrls, { timeout: 40_000, intervals: [1000] }).toBe(0)
})

test('a crashed worker (e.g. out of memory) shows a clear error and the app recovers', async ({ page }) => {
  await instrument(page, { crashFirst: 1 })
  await page.goto('/merge-pdf')
  await upload(page, 'text-8p.pdf', 'scan.pdf')
  await page.getByTestId('run').click()
  await expect(page.getByRole('alert')).toContainText('The processing worker crashed')
  expect((await stats(page)).live).toBe(0)
  // Retry with the same files: works.
  const { bytes } = await runAndDownload(page)
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(10)
})

test('two tabs can process at the same time', async ({ context }) => {
  const [a, b] = [await context.newPage(), await context.newPage()]
  await a.goto('/compress-pdf')
  await b.goto('/split-pdf')
  await upload(a, 'compress/photos.pdf')
  await upload(b, 'text-8p.pdf')
  await b.getByText('Every page', { exact: true }).click()
  await Promise.all([a.getByTestId('run').click(), b.getByTestId('run').click()])
  await expect(a.getByTestId('download')).toBeVisible({ timeout: 60_000 })
  await expect(b.getByTestId('download-zip')).toBeVisible({ timeout: 60_000 })
})

test('closing a tab mid-job leaves the app working in other tabs', async ({ context }) => {
  const first = await context.newPage()
  await first.goto('/compress-pdf')
  await upload(first, 'compress/photos.pdf')
  await first.getByTestId('run').click()
  await first.close() // worker dies with the tab
  const next = await context.newPage()
  await next.goto('/merge-pdf')
  await next.getByTestId('file-input').setInputFiles([fixturePath('text-8p.pdf'), fixturePath('scan.pdf')])
  await next.getByTestId('run').click()
  const [dl] = await Promise.all([next.waitForEvent('download'), next.getByTestId('download').click()])
  expect((await PDFDocument.load(readFileSync((await dl.path())!))).getPageCount()).toBe(10)
})
