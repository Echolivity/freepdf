// Real WebKit engine smoke test via WebDriver (WebKitGTK MiniBrowser + WebKitWebDriver), for machines
// where Playwright's own WebKit build can't be installed. This is the WebKit *engine* on Linux, not
// Safari and not iOS: it exercises WebKit's JS engine, workers, canvas, CSP and file handling.
//
// Setup (Ubuntu): sudo apt-get install webkit2gtk-driver xvfb
//                 npm i --no-save selenium-webdriver@4
//                 Xvfb :99 & DISPLAY=:99 WebKitWebDriver --port=4444 &
//                 npm run build && npm run preview   (or: npx wrangler pages dev dist --port 8788)
// Run:            BASE=http://127.0.0.1:4173 node qa/webkitgtk-smoke.mjs
// Cloudflare runtime: serve over HTTPS, because the production CSP's upgrade-insecure-requests makes
// WebKit upgrade http://127.0.0.1 sub-resources (Chromium exempts loopback; WebKit does not):
//   npx wrangler pages dev dist --port 8788 --ip 127.0.0.1 --local-protocol https
//   BASE=https://127.0.0.1:8788 node qa/webkitgtk-smoke.mjs   (self-signed cert accepted for loopback only)
// Exit code is non-zero if any check fails. Output files are validated with pdf-lib and qpdf.
import { Builder, By, until } from 'selenium-webdriver'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import JSZip from 'jszip'

const BASE = process.env.BASE || 'http://127.0.0.1:4173'
const DRIVER = process.env.WEBDRIVER || 'http://127.0.0.1:4444'
const BINARY = process.env.MINIBROWSER || '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser'
const fx = (n) => resolve('tests/fixtures', n)
const tmp = mkdtempSync(join(tmpdir(), 'freepdf-wk-'))
const results = []

const d = await new Builder()
  .usingServer(DRIVER)
  .withCapabilities({ browserName: 'MiniBrowser', acceptInsecureCerts: BASE.startsWith('https://127.0.0.1'), 'webkitgtk:browserOptions': { binary: BINARY, args: ['--automation'] } })
  .build()
await d.manage().setTimeouts({ script: 120_000 })
const ua = await (async () => { await d.get(BASE + '/'); return d.executeScript('return navigator.userAgent') })()

async function check(name, fn) {
  const t0 = Date.now()
  try {
    const note = await fn()
    results.push({ name, ok: true, note: note ?? '', ms: Date.now() - t0 })
  } catch (e) {
    results.push({ name, ok: false, note: String(e?.message ?? e).split('\n')[0].slice(0, 200), ms: Date.now() - t0 })
  }
  console.log(`${results.at(-1).ok ? 'PASS' : 'FAIL'}  ${name}  ${results.at(-1).note}`)
}

async function noAlert() {
  try {
    const text = await d.switchTo().alert().getText()
    throw new Error(`unexpected dialog: ${text}`)
  } catch (e) {
    if (String(e.message).startsWith('unexpected dialog')) throw e
  }
}

/** Upload files, run the tool, capture the produced Blob(s) exactly as the user would download them. */
async function runTool(route, files, { zip = false, before } = {}) {
  await d.get(BASE + route)
  const input = await d.wait(until.elementLocated(By.css('[data-testid="file-input"]')), 20_000)
  await input.sendKeys(files.join('\n'))
  if (before) await before()
  const run = await d.wait(until.elementLocated(By.css('[data-testid="run"]')), 20_000)
  await d.wait(until.elementIsEnabled(run), 30_000)
  await run.click()
  const sel = `[data-testid="${zip ? 'download-zip' : 'download'}"]`
  await d.wait(async () => {
    if ((await d.findElements(By.css(sel))).length) return true
    const alerts = await d.findElements(By.css('[role="alert"]'))
    for (const a of alerts) { const t = await a.getText(); if (t.trim()) throw new Error(`app reported: ${t.trim().slice(0, 160)}`) }
    return false
  }, 120_000)
  await d.wait(until.elementIsEnabled(await d.findElement(By.css(sel))), 60_000)
  // Capture the Blob handed to URL.createObjectURL for the download and read it back with FileReader
  // (test-only instrumentation; fetch() of a blob: URL is itself blocked by the app's connect-src CSP).
  const b64 = await d.executeAsyncScript(`
    const done = arguments[arguments.length - 1]
    const orig = URL.createObjectURL
    URL.createObjectURL = function (blob) {
      URL.createObjectURL = orig
      const fr = new FileReader()
      fr.onload = () => done({ data: String(fr.result).split(',')[1] ?? '', type: blob.type })
      fr.onerror = () => done({ error: String(fr.error) })
      fr.readAsDataURL(blob)
      return orig.call(URL, blob)
    }
    const origClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () { HTMLAnchorElement.prototype.click = origClick; window.__dlName = this.download }
    document.querySelector('[data-testid="${zip ? 'download-zip' : 'download'}"]').click()
  `)
  b64.name = await d.executeScript('return window.__dlName || ""')
  if (b64.error) throw new Error(b64.error)
  return { name: b64.name, bytes: Buffer.from(b64.data, 'base64') }
}

function qpdf(bytes) {
  const f = join(tmp, `o${Math.random().toString(36).slice(2)}.pdf`)
  writeFileSync(f, bytes)
  const r = spawnSync('qpdf', ['--check', f], { encoding: 'utf8' })
  if (r.error) return 'qpdf n/a'
  if (r.status !== 0 && r.status !== 3) throw new Error('qpdf --check failed')
  return 'qpdf ok'
}
const pages = async (bytes) => (await PDFDocument.load(bytes)).getPageCount()

// ---------------------------------------------------------------------------------------------------
const routes = readdirSync('dist').filter((f) => f.endsWith('.html') && f !== '404.html').map((f) => (f === 'index.html' ? '/' : '/' + f.slice(0, -5)))
await check(`all ${routes.length} routes render (en)`, async () => {
  for (const r of routes) {
    await d.get(BASE + r)
    await d.wait(until.elementLocated(By.css('h1')), 15_000)
  }
  return routes.join(' ')
})

await check('Arabic: RTL layout and translated UI', async () => {
  await d.get(BASE + '/')
  await d.executeScript("localStorage.setItem('freepdf:lang','ar')")
  await d.get(BASE + '/merge-pdf')
  const h1 = await d.wait(until.elementLocated(By.css('h1')), 15_000)
  const [dir, lang, text] = await Promise.all([d.executeScript('return document.documentElement.dir'), d.executeScript('return document.documentElement.lang'), h1.getText()])
  if (dir !== 'rtl' || lang !== 'ar' || !/[؀-ۿ]/.test(text)) throw new Error(`dir=${dir} lang=${lang} h1=${text}`)
  await d.executeScript("localStorage.setItem('freepdf:lang','en')")
  return `dir=rtl lang=ar h1="${text}"`
})

await check('Merge 2 PDFs', async () => {
  const { bytes } = await runTool('/merge-pdf', [fx('text-8p.pdf'), fx('structured.pdf')])
  const n = await pages(bytes)
  const exp = (await pages(await import('node:fs').then((m) => m.readFileSync(fx('text-8p.pdf'))))) + (await pages(await import('node:fs').then((m) => m.readFileSync(fx('structured.pdf')))))
  if (n !== exp) throw new Error(`pages ${n} != ${exp}`)
  return `${n} pages; ${qpdf(bytes)}`
})

await check('Rotate', async () => {
  const { bytes } = await runTool('/rotate-pdf', [fx('text-8p.pdf')], {
    before: async () => (await d.wait(until.elementLocated(By.xpath("//*[normalize-space(text())='180°']")), 15_000)).click(),
  })
  const doc = await PDFDocument.load(bytes)
  if (!doc.getPages().every((p) => p.getRotation().angle === 180)) throw new Error('pages not rotated 180°')
  return `${doc.getPageCount()} pages all at 180°; ${qpdf(bytes)}`
})

await check('Split (default settings, ZIP output)', async () => {
  const { bytes } = await runTool('/split-pdf', [fx('text-8p.pdf')], { zip: true })
  const z = await JSZip.loadAsync(bytes)
  const names = Object.keys(z.files)
  for (const n of names) qpdf(await z.files[n].async('uint8array'))
  if (names.length < 2) throw new Error(`zip has ${names.length} entries`)
  return `${names.length} PDFs in ZIP, all qpdf-valid`
})

await check('Compress (balanced, real JPEG re-encode in WebKit)', async () => {
  const src = (await import('node:fs')).readFileSync(fx('compress/photos.pdf'))
  const { bytes } = await runTool('/compress-pdf', [fx('compress/photos.pdf')])
  if ((await pages(bytes)) !== (await pages(src))) throw new Error('page count changed')
  return `${src.length} → ${bytes.length} bytes; ${qpdf(bytes)}`
})

await check('PDF → PNG (PDF.js canvas rendering)', async () => {
  const { bytes, name } = await runTool('/pdf-to-png', [fx('text-8p.pdf')], { zip: true })
  if (name.endsWith('.zip')) {
    const z = await JSZip.loadAsync(bytes)
    const first = await z.files[Object.keys(z.files)[0]].async('uint8array')
    if (Buffer.from(first.subarray(1, 4)).toString() !== 'PNG') throw new Error('not a PNG')
    return `${Object.keys(z.files).length} PNGs`
  }
  if (bytes.subarray(1, 4).toString() !== 'PNG') throw new Error('not a PNG')
  return `PNG ${bytes.length} bytes`
})

await check('JPG → PDF (EXIF-rotated photo)', async () => {
  const { bytes } = await runTool('/jpg-to-pdf', [fx('rotated-exif6.jpg'), fx('photo.jpg')])
  const doc = await PDFDocument.load(bytes)
  const { width, height } = doc.getPage(0).getSize()
  return `${doc.getPageCount()} pages, page 1 ${Math.round(width)}×${Math.round(height)}; ${qpdf(bytes)}`
})

await check('Organize: thumbnails render; embedded PDF JavaScript does not run', async () => {
  const doc = await PDFDocument.create()
  doc.addPage([400, 300]); doc.addPage([400, 300])
  const ctx = doc.context
  const js = ctx.register(ctx.obj({ Type: 'Action', S: 'JavaScript', JS: PDFString.of("app.alert('pdf-js-ran'); app.launchURL('https://attacker.example/', true)") }))
  doc.catalog.set(PDFName.of('OpenAction'), js)
  const f = join(tmp, 'scripted.pdf')
  writeFileSync(f, await doc.save())
  await d.get(BASE + '/organize-pdf')
  await (await d.wait(until.elementLocated(By.css('[data-testid="file-input"]')), 20_000)).sendKeys(f)
  await d.wait(async () => (await d.findElements(By.css('canvas, img[src^="blob:"]'))).length >= 2, 30_000)
  await d.sleep(1000)
  await noAlert()
  const url = await d.getCurrentUrl()
  if (!url.startsWith(BASE + '/organize-pdf')) throw new Error(`navigated to ${url}`)
  return 'thumbnails rendered, no dialog, no navigation'
})

await check('CSP blocks outbound requests; storage holds only documented keys', async () => {
  await d.get(BASE + '/')
  const r = await d.executeAsyncScript(`
    const done = arguments[arguments.length - 1]
    fetch('https://example.com/beacon', { mode: 'no-cors' }).then(() => done('ALLOWED'), () => done('blocked'))
  `)
  if (r !== 'blocked') throw new Error('external fetch was not blocked by CSP')
  const keys = await d.executeScript('return Object.keys(localStorage)')
  const bad = keys.filter((k) => !['freepdf:theme', 'freepdf:lang', 'freepdf:recent'].includes(k))
  if (bad.length) throw new Error(`undocumented storage keys: ${bad}`)
  return `external fetch blocked; storage keys: ${keys.join(', ') || '(none)'}`
})

await d.quit()
const failed = results.filter((r) => !r.ok)
console.log(`\nWebKitGTK (${ua})\n${results.length - failed.length}/${results.length} passed`)
writeFileSync(join('qa', 'results', 'webkitgtk.json'), JSON.stringify({ ua, base: BASE, date: new Date().toISOString(), results }, null, 2))
process.exit(failed.length ? 1 : 0)
