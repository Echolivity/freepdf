import { test, expect, type Page, type CDPSession } from '@playwright/test'
import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { pypdf, qpdf, signatureIntact, textOf } from './validate'
import { inspectRequest } from '../tests/e2e/fixtures'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Real-world QA: drives the production build in Chromium with realistic and hostile inputs, timing each
 * operation and validating every output with independent tools. Every row in the report comes from an
 * executed step; a failed expectation is recorded as FAIL and also fails the run.
 */
const IN = (n: string) => join(__dirname, '.inputs', n)
const FX = (n: string) => join(__dirname, '..', 'tests', 'fixtures', n)
const RESULTS = join(__dirname, 'results')
mkdirSync(RESULTS, { recursive: true })

interface Row { id: string; category: string; input: string; operation: string; expected: string; actual: string; ms: number | null; outBytes: number | null; status: 'PASS' | 'FAIL' }
function record(row: Row) { appendFileSync(join(RESULTS, 'raw.jsonl'), JSON.stringify(row) + '\n') }
const mb = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`)
const describeFile = (p: string, extra: string) => `${p.split('/').pop()} (${mb(statSync(p).size)}; ${extra})`

/** Run a scenario: `fn` returns actual text + metrics and throws on a failed expectation. */
async function scenario(meta: Omit<Row, 'actual' | 'ms' | 'outBytes' | 'status'>, fn: () => Promise<{ actual: string; ms?: number; outBytes?: number }>) {
  try {
    const r = await fn()
    record({ ...meta, actual: r.actual, ms: r.ms ?? null, outBytes: r.outBytes ?? null, status: 'PASS' })
  } catch (e) {
    record({ ...meta, actual: `FAILED: ${(e as Error).message.split('\n')[0].slice(0, 220)}`, ms: null, outBytes: null, status: 'FAIL' })
    throw e
  }
}

test.beforeAll(async ({ browser }) => {
  const os = await import('node:os')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(join(RESULTS, 'env.json'), JSON.stringify({
    browser: `Chromium ${browser.version()} (Playwright, headless)`,
    cpu: `${os.cpus().length} × ${os.cpus()[0]?.model ?? 'unknown CPU'}`,
    ram: `${Math.round(os.totalmem() / 1073741824)} GB`,
    platform: `${os.platform()} ${os.release()}`,
    node: process.version,
    date: new Date().toISOString(),
    server: process.env.PW_BASE_URL ? `Cloudflare Pages runtime (wrangler pages dev) at ${process.env.PW_BASE_URL}` : 'vite preview (production build with production headers)',
  }, null, 2))
})

/** Privacy: every request during the QA run is checked by the same rules as the test guard. */
let leaks: string[] = []
test.beforeEach(async ({ page, baseURL }) => {
  leaks = []
  page.context().on('request', (r) => { const p = inspectRequest(r, new URL(baseURL!).origin); if (p) leaks.push(p) })
})
test.afterEach(() => expect(leaks, leaks.join('\n')).toEqual([]))

async function runTool(page: Page, opts: { zip?: boolean } = {}) {
  const t0 = Date.now()
  await page.getByTestId('run').click()
  const btn = page.getByTestId(opts.zip ? 'download-zip' : 'download')
  await expect(btn).toBeVisible({ timeout: 10 * 60_000 })
  const ms = Date.now() - t0
  const [dl] = await Promise.all([page.waitForEvent('download'), btn.click()])
  const bytes = new Uint8Array(readFileSync((await dl.path())!))
  return { ms, bytes, name: dl.suggestedFilename() }
}
async function select(page: Page, ...paths: string[]) { await page.getByTestId('file-input').first().setInputFiles(paths) }
function validPdf(bytes: Uint8Array, pages?: number) {
  const q = qpdf(bytes)
  const p = pypdf(bytes)
  if (!q.ok) throw new Error(q.note)
  if (!p.ok) throw new Error(p.note)
  if (pages !== undefined && p.pages !== pages) throw new Error(`expected ${pages} pages, pypdf saw ${p.pages}`)
  return `${q.note}; ${p.note} (${p.pages} p.)`
}

// ---------------------------------------------------------------- large (>100 MB)
test('large file: compress, split, merge, convert', async ({ page }) => {
  const large = IN('large.pdf')
  const size = statSync(large).size
  const pages = (await PDFDocument.load(readFileSync(large))).getPageCount()
  const input = describeFile(large, `${pages} pages of 3000×2200 incompressible photos`)

  await page.goto('/compress-pdf')
  await select(page, large)
  await scenario({ id: 'L1', category: 'Large PDF', input, operation: 'Compress (Balanced)', expected: 'Smaller, valid PDF, all pages' }, async () => {
    const { ms, bytes } = await runTool(page)
    if (bytes.length >= size) throw new Error('not smaller')
    return { actual: `${mb(size)} → ${mb(bytes.length)} (−${Math.round((1 - bytes.length / size) * 100)}%); ${validPdf(bytes, pages)}`, ms, outBytes: bytes.length }
  })

  await page.goto('/compress-pdf')
  await select(page, large)
  await page.getByText('Lossless', { exact: true }).click()
  await scenario({ id: 'L2', category: 'Large PDF', input, operation: 'Compress (Lossless)', expected: 'Never larger; images untouched; valid' }, async () => {
    const { ms, bytes } = await runTool(page)
    if (bytes.length > size) throw new Error('grew')
    return { actual: `${mb(size)} → ${mb(bytes.length)}; ${validPdf(bytes, pages)}`, ms, outBytes: bytes.length }
  })

  await page.goto('/split-pdf')
  await select(page, large)
  await page.getByTestId('ranges').fill(`1-${Math.floor(pages / 2)}, ${Math.floor(pages / 2) + 1}-${pages}`)
  await scenario({ id: 'L3', category: 'Large PDF', input, operation: 'Split into 2 ranges', expected: 'ZIP with 2 valid PDFs covering all pages' }, async () => {
    const { ms, bytes } = await runTool(page, { zip: true })
    const zip = await JSZip.loadAsync(bytes)
    let total = 0
    for (const f of Object.values(zip.files)) { const b = await f.async('uint8array'); validPdf(b); total += (await PDFDocument.load(b)).getPageCount() }
    if (total !== pages) throw new Error(`pages ${total} ≠ ${pages}`)
    return { actual: `${Object.keys(zip.files).length} files, ${total} pages total, all qpdf + pypdf ok`, ms, outBytes: bytes.length }
  })

  await page.goto('/merge-pdf')
  await select(page, large, FX('text-8p.pdf'))
  await scenario({ id: 'L4', category: 'Large PDF', input: `${input} + text-8p.pdf`, operation: 'Merge', expected: `${pages + 8} pages, valid` }, async () => {
    const { ms, bytes } = await runTool(page)
    return { actual: validPdf(bytes, pages + 8), ms, outBytes: bytes.length }
  })

  await page.goto('/pdf-to-jpg')
  await select(page, large)
  await page.getByText('72 DPI').click()
  await scenario({ id: 'L5', category: 'Large PDF', input, operation: 'PDF → JPG (72 DPI)', expected: `${pages} JPEGs` }, async () => {
    const { ms, bytes } = await runTool(page, { zip: true })
    const n = Object.keys((await JSZip.loadAsync(bytes)).files).length
    if (n !== pages) throw new Error(`${n} images`)
    return { actual: `${n} JPEG images`, ms, outBytes: bytes.length }
  })
})

// ---------------------------------------------------------------- multi-hundred pages
test('800-page document', async ({ page }) => {
  const f = IN('pages-800.pdf')
  const input = describeFile(f, '800 text pages')
  await page.goto('/split-pdf')
  await select(page, f)
  await page.getByText('Every page', { exact: true }).click()
  await scenario({ id: 'P1', category: 'Multi-hundred pages', input, operation: 'Split every page', expected: '800 single-page PDFs' }, async () => {
    const { ms, bytes } = await runTool(page, { zip: true })
    const zip = await JSZip.loadAsync(bytes)
    const files = Object.values(zip.files)
    if (files.length !== 800) throw new Error(`${files.length} files`)
    validPdf(await files[799].async('uint8array'), 1)
    return { actual: '800 files; last part validated (qpdf + pypdf, 1 page)', ms, outBytes: bytes.length }
  })
  await page.goto('/extract-pages')
  await select(page, f)
  await page.getByTestId('ranges').fill('1-400')
  await scenario({ id: 'P2', category: 'Multi-hundred pages', input, operation: 'Extract pages 1–400', expected: '400 pages, page 400 text intact' }, async () => {
    const { ms, bytes } = await runTool(page)
    if (!textOf(bytes, 399).includes('Page 400 of 800')) throw new Error('page 400 text missing')
    return { actual: `${validPdf(bytes, 400)}; page 400 text verified`, ms, outBytes: bytes.length }
  })
  await page.goto('/organize-pdf')
  await select(page, f)
  await scenario({ id: 'P3', category: 'Multi-hundred pages', input, operation: 'Organize: open 800 thumbnails, delete page 1, save', expected: 'Grid renders lazily; 799 pages saved' }, async () => {
    const t0 = Date.now()
    await expect(page.getByRole('list', { name: 'Pages' }).getByRole('listitem')).toHaveCount(800)
    const gridMs = Date.now() - t0
    await page.getByRole('button', { name: 'Delete page 1', exact: true }).click()
    const { ms, bytes } = await runTool(page)
    return { actual: `grid ready in ${gridMs} ms; ${validPdf(bytes, 799)}`, ms, outBytes: bytes.length }
  })
  await page.goto('/pdf-to-png')
  await select(page, f)
  await page.getByText('72 DPI').click()
  await scenario({ id: 'P4', category: 'Multi-hundred pages', input, operation: 'PDF → PNG, 800 pages (72 DPI)', expected: '800 PNGs' }, async () => {
    const { ms, bytes } = await runTool(page, { zip: true })
    const n = Object.keys((await JSZip.loadAsync(bytes)).files).length
    if (n !== 800) throw new Error(`${n} images`)
    return { actual: '800 PNG images', ms, outBytes: bytes.length }
  })
})

// ---------------------------------------------------------------- password-protected
test('password-protected PDFs', async ({ page }) => {
  const user = FX('encrypted-user.pdf')
  const owner = FX('encrypted-owner.pdf')
  await page.goto('/merge-pdf')
  await select(page, user, FX('text-8p.pdf'))
  await scenario({ id: 'S1', category: 'Password-protected', input: describeFile(user, 'AES-256, user password'), operation: 'Merge (before running)', expected: 'Flagged as protected before processing' }, async () => {
    await expect(page.getByTestId('file-warnings')).toContainText('password-protected, so this tool can’t open it')
    return { actual: 'Warning shown on file add' }
  })
  await scenario({ id: 'S2', category: 'Password-protected', input: describeFile(user, 'AES-256, user password'), operation: 'Merge (run anyway)', expected: 'Clear error; app stays usable' }, async () => {
    await page.getByTestId('run').click()
    await expect(page.getByRole('alert')).toContainText('is password-protected')
    return { actual: 'Error: “encrypted-user.pdf is password-protected…”' }
  })
  await page.goto('/pdf-to-png')
  await select(page, user)
  await page.getByPlaceholder('Enter the document password').fill('wrong')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await scenario({ id: 'S3', category: 'Password-protected', input: describeFile(user, 'AES-256'), operation: 'PDF → PNG, wrong password', expected: 'Rejected with message' }, async () => {
    await expect(page.getByText('That password isn’t correct.')).toBeVisible()
    return { actual: 'Rejected: “That password isn’t correct.”' }
  })
  await page.getByPlaceholder('Enter the document password').fill('secret')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.getByText('72 DPI').click()
  await scenario({ id: 'S4', category: 'Password-protected', input: describeFile(user, 'AES-256'), operation: 'PDF → PNG, correct password', expected: '8 PNGs, decrypted locally' }, async () => {
    const { ms, bytes } = await runTool(page, { zip: true })
    const n = Object.keys((await JSZip.loadAsync(bytes)).files).length
    if (n !== 8) throw new Error(`${n}`)
    return { actual: '8 PNG images', ms, outBytes: bytes.length }
  })
  await page.goto('/pdf-to-png')
  await select(page, owner)
  await page.getByText('72 DPI').click()
  await scenario({ id: 'S5', category: 'Password-protected', input: describeFile(owner, 'owner password only (permissions)'), operation: 'PDF → PNG', expected: 'Opens without asking for a password' }, async () => {
    const { ms, bytes } = await runTool(page, { zip: true })
    return { actual: `${Object.keys((await JSZip.loadAsync(bytes)).files).length} PNG images, no prompt`, ms, outBytes: bytes.length }
  })
})

// ---------------------------------------------------------------- digitally signed
test('digitally signed and certified PDFs', async ({ page }) => {
  const signed = FX('signed.pdf')
  const certified = FX('certified.pdf')
  const sInput = describeFile(signed, 'PAdES signature, self-signed test cert')
  await page.goto('/rotate-pdf')
  await select(page, signed)
  await scenario({ id: 'G1', category: 'Digitally signed', input: sInput, operation: 'Rotate (warning)', expected: 'Signature warning before processing' }, async () => {
    await expect(page.getByTestId('file-warnings')).toContainText('is digitally signed')
    return { actual: 'Warning shown on file add' }
  })
  await scenario({ id: 'G2', category: 'Digitally signed', input: sInput, operation: 'Rotate (run)', expected: 'Valid PDF; signature no longer intact (as warned)' }, async () => {
    const { ms, bytes } = await runTool(page)
    const intact = signatureIntact(bytes)
    if (intact === true) throw new Error('signature unexpectedly still intact after rotation')
    return { actual: `${validPdf(bytes)}; pyHanko intact=${intact}`, ms, outBytes: bytes.length }
  })
  await page.goto('/extract-pages')
  await select(page, signed)
  await page.getByRole('button', { name: 'Select all' }).click()
  await scenario({ id: 'G3', category: 'Digitally signed', input: sInput, operation: 'Extract all pages (no-op)', expected: 'Original returned byte-for-byte; signature still intact' }, async () => {
    const { ms, bytes } = await runTool(page)
    const same = Buffer.from(bytes).equals(readFileSync(signed))
    const intact = signatureIntact(bytes)
    if (!same) throw new Error('bytes differ')
    if (intact === false) throw new Error('signature broken')
    return { actual: `identical to input; pyHanko intact=${intact}`, ms, outBytes: bytes.length }
  })
  await page.goto('/remove-pages')
  await select(page, certified)
  await scenario({ id: 'G4', category: 'Digitally signed', input: describeFile(certified, 'certification (DocMDP: no changes)'), operation: 'Remove pages (warning)', expected: 'Certification warning' }, async () => {
    await expect(page.getByTestId('file-warnings')).toContainText('certified by its author')
    return { actual: 'Certification warning shown' }
  })
})

// ---------------------------------------------------------------- Arabic
test('Arabic documents and interface', async ({ page }) => {
  const ar = FX('arabic.pdf')
  const input = describeFile(ar, '3 pages, Arabic + Latin, embedded CID fonts')
  await page.addInitScript(() => localStorage.setItem('freepdf:lang', 'ar'))
  await page.goto('/merge-pdf')
  await page.getByTestId('file-input').setInputFiles([
    { name: 'عقد إيجار.pdf', mimeType: 'application/pdf', buffer: readFileSync(ar) },
    { name: 'text-8p.pdf', mimeType: 'application/pdf', buffer: readFileSync(FX('text-8p.pdf')) },
  ])
  await scenario({ id: 'A1', category: 'Arabic', input, operation: 'Merge in Arabic UI (Arabic file name)', expected: '11 pages; Arabic name kept; Arabic text extractable' }, async () => {
    const { ms, bytes, name } = await runTool(page)
    if (name !== 'عقد إيجار-merged.pdf') throw new Error(`name ${name}`)
    if (!/[؀-ۿﭐ-﻿]/.test(textOf(bytes, 0))) throw new Error('no Arabic text')
    return { actual: `${validPdf(bytes, 11)}; file “${name}”; Arabic text extracted`, ms, outBytes: bytes.length }
  })
  await page.goto('/split-pdf')
  await select(page, ar)
  await page.getByTestId('ranges').fill('١، ٢-٣')
  await scenario({ id: 'A2', category: 'Arabic', input, operation: 'Split with Arabic-Indic digits “١، ٢-٣”', expected: '2 parts (1 + 2 pages)' }, async () => {
    const { ms, bytes } = await runTool(page, { zip: true })
    const n = Object.keys((await JSZip.loadAsync(bytes)).files).length
    if (n !== 2) throw new Error(`${n}`)
    return { actual: '2 valid parts', ms, outBytes: bytes.length }
  })
  await page.goto('/compress-pdf')
  await select(page, ar)
  await scenario({ id: 'A3', category: 'Arabic', input, operation: 'Compress (Balanced)', expected: 'Text and fonts untouched; never larger' }, async () => {
    const { ms, bytes } = await runTool(page)
    if (bytes.length > statSync(ar).size) throw new Error('grew')
    return { actual: `${validPdf(bytes, 3)}`, ms, outBytes: bytes.length }
  })
})

// ---------------------------------------------------------------- corrupted / malformed
test('corrupted and malformed inputs', async ({ page }) => {
  const cases: [string, string, string, RegExp][] = [
    ['zero-bytes.pdf', 'empty file', 'Rejected on add', /is empty/],
    ['png-renamed.pdf', 'PNG renamed to .pdf', 'Rejected on add (content check)', /isn't a PDF file \(it looks like PNG\)/],
    ['header-then-garbage.pdf', '%PDF header + 50 KB random bytes', 'Clear error naming the file, no crash', /header-then-garbage\.pdf.*(couldn.t be (read|opened)|is damaged)/],
    ['truncated-half.pdf', 'valid PDF cut in half', 'Recovered or clear error, no crash', /.*/],
    ['xref-destroyed.pdf', 'cross-reference table overwritten', 'Recovered (pages rebuilt) or clear error', /.*/],
  ]
  for (const [file, what, expected, pattern] of cases) {
    await page.goto('/rotate-pdf')
    await select(page, IN(file))
    await scenario({ id: `C-${file}`, category: 'Corrupted / malformed', input: `${file} (${what})`, operation: 'Rotate', expected }, async () => {
      const t0 = Date.now()
      const rejected = page.getByRole('alert')
      // Validation is asynchronous: wait until the file is either rejected or accepted before branching.
      await expect(rejected.or(page.getByTestId('run'))).toBeVisible({ timeout: 30_000 })
      if (await rejected.isVisible().catch(() => false)) {
        const text = (await rejected.innerText()).trim()
        if (!pattern.test(text)) throw new Error(`unexpected message: ${text}`)
        return { actual: `Rejected: ${text.slice(0, 110)}`, ms: Date.now() - t0 }
      }
      await page.getByTestId('run').click()
      const ok = page.getByTestId('download')
      const err = page.getByRole('alert')
      await expect(ok.or(err)).toBeVisible()
      if (await ok.isVisible()) {
        const [dl] = await Promise.all([page.waitForEvent('download'), ok.click()])
        const bytes = new Uint8Array(readFileSync((await dl.path())!))
        return { actual: `Recovered: ${validPdf(bytes)}`, ms: Date.now() - t0, outBytes: bytes.length }
      }
      const text = (await err.innerText()).trim()
      if (!pattern.test(text)) throw new Error(`unexpected message: ${text}`)
      return { actual: `Error shown: ${text.slice(0, 110)}`, ms: Date.now() - t0 }
    })
  }
})

// ---------------------------------------------------------------- low memory, interruption, repetition
test('low-memory, interruption and repeated processing', async ({ page, context }) => {
  const large = IN('large.pdf')
  const low = await context.newPage()
  await low.addInitScript(() => Object.defineProperty(navigator, 'deviceMemory', { value: 2 }))
  await low.goto('/compress-pdf')
  await low.getByTestId('file-input').setInputFiles(large)
  await scenario({ id: 'M1', category: 'Low memory', input: describeFile(large, 'device reports 2 GB'), operation: 'Add file', expected: 'Refused up front with the 100 MB limit stated' }, async () => {
    await expect(low.getByRole('alert')).toContainText('The limit per file is 100 MB')
    return { actual: (await low.getByRole('alert').innerText()).slice(0, 120) }
  })
  await low.close()

  await page.goto('/compress-pdf')
  await select(page, large)
  await scenario({ id: 'M2', category: 'Interrupted processing', input: describeFile(large, 'large'), operation: 'Cancel mid-compression, then run again', expected: 'Worker stops; second run completes' }, async () => {
    await page.getByTestId('run').click()
    await page.waitForTimeout(1500)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('run')).toBeVisible()
    const { ms, bytes } = await runTool(page)
    return { actual: `cancelled cleanly; rerun ok (${mb(bytes.length)})`, ms, outBytes: bytes.length }
  })

  const doomed = await context.newPage()
  await doomed.goto('/compress-pdf')
  await doomed.getByTestId('file-input').setInputFiles(large)
  await doomed.getByTestId('run').click()
  await doomed.waitForTimeout(1000)
  await doomed.close()
  await scenario({ id: 'M3', category: 'Interrupted processing', input: describeFile(large, 'large'), operation: 'Close tab mid-job, use another tab', expected: 'Other tab unaffected' }, async () => {
    await page.goto('/merge-pdf')
    await select(page, FX('text-8p.pdf'), FX('scan.pdf'))
    const { ms, bytes } = await runTool(page)
    return { actual: validPdf(bytes, 10), ms, outBytes: bytes.length }
  })

  // Repeated processing: JS heap after forced GC must not keep growing.
  const cdp: CDPSession = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage')
    const { metrics } = await cdp.send('Performance.getMetrics')
    return metrics.find((m) => m.name === 'JSHeapUsedSize')!.value
  }
  const photos = FX('compress/photos.pdf')
  const samples: number[] = []
  await page.goto('/compress-pdf')
  const t0 = Date.now()
  for (let i = 0; i < 20; i++) {
    await select(page, photos)
    await runTool(page)
    await page.getByTestId('start-over').click()
    if (i === 2 || i === 19) samples.push(await heap())
  }
  await scenario({ id: 'M4', category: 'Memory leaks', input: describeFile(photos, '3 photos'), operation: 'Compress 20× in one tab (start over each time)', expected: 'Heap after run 20 ≤ run 3 + 10 MB' }, async () => {
    const [a, b] = samples
    if (b > a + 10 * 1048576) throw new Error(`heap grew ${mb(a)} → ${mb(b)}`)
    return { actual: `JS heap after GC: run 3 ${mb(a)}, run 20 ${mb(b)}`, ms: Date.now() - t0 }
  })
})

/** v1.1.0 tools: Resize PDF and Compare PDF on the same hostile and realistic inputs. */
test('resize and compare (v1.1.0)', async ({ page }) => {
  test.setTimeout(15 * 60_000)
  const large = IN('large.pdf')
  const p800 = IN('pages-800.pdf')
  const pageSize = (bytes: Uint8Array, i = 0) => PDFDocument.load(bytes).then((d) => d.getPage(i).getSize())

  await page.goto('/resize-pdf')
  await select(page, large)
  await page.getByTestId('rs-size').selectOption('letter')
  await scenario({ id: 'R1', category: 'Resize', input: describeFile(large, '20 photo pages'), operation: 'Resize to Letter (fit)', expected: 'Valid, all pages Letter, images untouched (size ≈ same)' }, async () => {
    const { ms, bytes } = await runTool(page)
    const s = await pageSize(bytes)
    if (Math.abs(s.width - 612) > 1 && Math.abs(s.width - 792) > 1) throw new Error(`page 1 is ${s.width}×${s.height}`)
    const ratio = bytes.length / statSync(large).size
    if (ratio < 0.98 || ratio > 1.02) throw new Error(`size changed by ${(100 * (ratio - 1)).toFixed(1)}% (images re-encoded?)`)
    return { actual: `${validPdf(bytes, 20)}; ${mb(statSync(large).size)} → ${mb(bytes.length)}`, ms, outBytes: bytes.length }
  })

  await page.goto('/resize-pdf')
  await select(page, p800)
  await page.getByTestId('rs-size').selectOption('a5')
  await scenario({ id: 'R2', category: 'Resize', input: describeFile(p800, '800 text pages'), operation: 'Resize to A5 (fit)', expected: '800 A5 pages; text still extractable' }, async () => {
    const { ms, bytes } = await runTool(page)
    const s = await pageSize(bytes, 799)
    if (Math.abs(s.width - 419.53) > 1) throw new Error(`last page is ${s.width}×${s.height}`)
    const text = textOf(bytes, 399)
    if (!/400/.test(text)) throw new Error(`page 400 text not found: ${text.slice(0, 60)}`)
    return { actual: `${validPdf(bytes, 800)}; page 400 text verified`, ms, outBytes: bytes.length }
  })

  await page.goto('/resize-pdf')
  await select(page, FX('signed.pdf'))
  await scenario({ id: 'R3', category: 'Resize', input: describeFile(FX('signed.pdf'), 'PAdES signature'), operation: 'Resize (warning)', expected: 'Signature warning before processing' }, async () => {
    await expect(page.getByTestId('file-warnings')).toContainText('is digitally signed')
    return { actual: 'Warning shown on file add' }
  })

  // Compare: the 800-page document against a copy with one page's text changed.
  const changed = await (async () => {
    const doc = await PDFDocument.load(readFileSync(p800))
    const { StandardFonts } = await import('pdf-lib')
    const font = await doc.embedFont(StandardFonts.Helvetica)
    doc.getPage(499).drawText('INSERTED CLAUSE', { x: 72, y: 60, size: 12, font })
    return Buffer.from(await doc.save())
  })()
  await page.goto('/compare-pdf')
  await page.getByTestId('file-input').setInputFiles([
    { name: 'pages-800.pdf', mimeType: 'application/pdf', buffer: readFileSync(p800) },
    { name: 'pages-800-edited.pdf', mimeType: 'application/pdf', buffer: changed },
  ])
  await scenario({ id: 'C1', category: 'Compare', input: 'pages-800.pdf vs a copy with 2 words added on page 500', operation: 'Compare', expected: 'Exactly page 500 reported; 2 words added' }, async () => {
    const t0 = Date.now()
    await page.getByTestId('run').click()
    await expect(page.getByTestId('cmp-stats')).toBeVisible({ timeout: 5 * 60_000 })
    const ms = Date.now() - t0
    await expect(page.getByTestId('cmp-stats')).toContainText('Words removed: 0 · words added: 2')
    await expect(page.getByTestId('cmp-pages').getByRole('button')).toHaveText(['500'])
    return { actual: 'page 500 only; 0 removed, 2 added', ms }
  })

  await page.goto('/compare-pdf')
  await select(page, large, large)
  await scenario({ id: 'C2', category: 'Compare', input: describeFile(large, 'compared with itself'), operation: 'Compare + visual check of all pages', expected: 'No text changes; no visual differences' }, async () => {
    const t0 = Date.now()
    await page.getByTestId('run').click()
    await expect(page.getByRole('heading', { name: 'No text differences found' })).toBeVisible({ timeout: 5 * 60_000 })
    await page.getByTestId('cmp-scan').click()
    await expect(page.getByTestId('cmp-scan-result')).toHaveText('No visual differences found.', { timeout: 5 * 60_000 })
    return { actual: 'no text changes; 0 of 20 pages visually different', ms: Date.now() - t0 }
  })
})
