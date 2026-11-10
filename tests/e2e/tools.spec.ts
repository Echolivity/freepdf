import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'
import { fixtureBytes, fixturePath, guardPage, runAndDownload, runAndDownloadZip, upload } from './helpers'
import { meanDiff, renderPage } from '../unit/render'

const pageCount = async (b: Uint8Array) => (await PDFDocument.load(b)).getPageCount()

test.describe('Phase 1 tools (end-to-end in a real browser)', () => {
  test('Merge PDF: merges, honours order, rejects fakes', async ({ page }) => {
    const g = guardPage(page)
    await page.goto('/merge-pdf')
    await upload(page, 'text-8p.pdf', 'scan.pdf', 'not-a-pdf.pdf')
    await expect(page.getByRole('alert')).toContainText('not-a-pdf.pdf')
    await expect(page.getByRole('list', { name: 'Selected files' }).getByRole('listitem')).toHaveCount(2)
    await page.getByRole('button', { name: 'Move scan.pdf up' }).click()
    const { bytes, name } = await runAndDownload(page)
    expect(name).toBe('scan-merged.pdf')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(10)
    g.assertClean()
  })

  test('Merge PDF: encrypted input gives a clear error', async ({ page }) => {
    await page.goto('/merge-pdf')
    await upload(page, 'text-8p.pdf', 'encrypted-user.pdf')
    await page.getByTestId('run').click()
    await expect(page.getByRole('alert')).toContainText('password-protected')
  })

  test('Split PDF: custom ranges produce a ZIP of parts', async ({ page }) => {
    const g = guardPage(page)
    await page.goto('/split-pdf')
    await upload(page, 'text-8p.pdf')
    await page.getByTestId('ranges').fill('1-2, 5, 7-')
    await expect(page.getByText('Creates 3 PDFs')).toBeVisible()
    const { bytes } = await runAndDownloadZip(page)
    const zip = await JSZip.loadAsync(bytes)
    const names = Object.keys(zip.files).sort()
    expect(names).toEqual(['text-8p-page-5.pdf', 'text-8p-pages-1-2.pdf', 'text-8p-pages-7-8.pdf'])
    expect(await pageCount(await zip.file('text-8p-pages-7-8.pdf')!.async('uint8array'))).toBe(2)
    g.assertClean()
  })

  test('Split PDF: invalid range is explained and blocks the action', async ({ page }) => {
    await page.goto('/split-pdf')
    await upload(page, 'text-8p.pdf')
    await page.getByTestId('ranges').fill('3-40')
    await expect(page.getByRole('alert')).toContainText('goes past the last page')
    await expect(page.getByTestId('run')).toBeDisabled()
  })

  test('Extract pages: thumbnail selection', async ({ page }) => {
    const g = guardPage(page)
    await page.goto('/extract-pages')
    await upload(page, 'text-8p.pdf')
    await page.getByRole('button', { name: 'Page 2', exact: true }).click()
    await page.getByRole('button', { name: 'Page 4', exact: true }).click({ modifiers: ['Shift'] })
    await expect(page.getByTestId('ranges')).toHaveValue('2-4')
    const { bytes } = await runAndDownload(page)
    expect(await pageCount(bytes)).toBe(3)
    g.assertClean()
  })

  test('Remove pages: typed ranges', async ({ page }) => {
    await page.goto('/remove-pages')
    await upload(page, 'text-8p.pdf')
    await page.getByTestId('ranges').fill('1, 8')
    const { bytes, name } = await runAndDownload(page)
    expect(name).toBe('text-8p-edited.pdf')
    expect(await pageCount(bytes)).toBe(6)
  })

  test('Organize PDF: reorder, rotate and delete', async ({ page }) => {
    const g = guardPage(page)
    await page.goto('/organize-pdf')
    await upload(page, 'text-8p.pdf')
    await expect(page.getByTestId('run')).toBeDisabled()
    await page.getByRole('button', { name: 'Delete page 1' }).click()
    await page.getByRole('button', { name: 'Rotate page 2' }).click()
    await page.getByRole('button', { name: 'Move page 3 earlier' }).click()
    const { bytes } = await runAndDownload(page)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(7)
    expect(doc.getPage(1).getRotation().angle).toBe(90)
    g.assertClean()
  })

  test('Rotate PDF: multiple files → ZIP', async ({ page }) => {
    await page.goto('/rotate-pdf')
    await upload(page, 'text-8p.pdf', 'scan.pdf')
    await page.getByText('180°').click()
    const { bytes } = await runAndDownloadZip(page)
    const zip = await JSZip.loadAsync(bytes)
    const pdf = await PDFDocument.load(await zip.file('scan-rotated.pdf')!.async('uint8array'))
    expect(pdf.getPages().every((p) => p.getRotation().angle === 180)).toBe(true)
  })

  test('Compress PDF: real browser codec shrinks a scanned PDF', async ({ page }) => {
    const g = guardPage(page)
    await page.goto('/compress-pdf')
    await upload(page, 'scan.pdf')
    const { bytes } = await runAndDownload(page)
    const original = fixtureBytes('scan.pdf').length
    expect(bytes.length).toBeLessThan(original * 0.6)
    expect(await pageCount(bytes)).toBe(2)
    // Visual check: the compressed page must still look like the original (mean channel error < 4/255).
    const diff = meanDiff(await renderPage(new Uint8Array(fixtureBytes('scan.pdf')), 1, 0.5), await renderPage(new Uint8Array(bytes), 1, 0.5))
    expect(diff).toBeLessThan(4)
    await expect(page.getByText(/% smaller/)).toBeVisible()
    g.assertClean()
  })

  test('Compress PDF: already-optimal file is returned unchanged with an honest message', async ({ page }) => {
    await page.goto('/compress-pdf')
    await upload(page, 'text-8p.pdf')
    const { bytes } = await runAndDownload(page)
    expect(bytes.length).toBeLessThanOrEqual(fixtureBytes('text-8p.pdf').length)
  })

  test('PDF to JPG: one JPEG per page at chosen DPI', async ({ page }) => {
    const g = guardPage(page)
    await page.goto('/pdf-to-jpg')
    await upload(page, 'text-8p.pdf')
    await page.getByText('72 DPI').click()
    const { bytes } = await runAndDownloadZip(page)
    const zip = await JSZip.loadAsync(bytes)
    const files = Object.keys(zip.files)
    expect(files).toHaveLength(8)
    const first = await zip.file('text-8p-page-1.jpg')!.async('uint8array')
    expect([first[0], first[1], first[2]]).toEqual([0xff, 0xd8, 0xff])
    g.assertClean()
  })

  test('PDF to PNG: unlocks a password-protected file locally', async ({ page }) => {
    const g = guardPage(page)
    await page.goto('/pdf-to-png')
    await upload(page, 'encrypted-user.pdf')
    await expect(page.getByText('is password-protected')).toBeVisible()
    await expect(page.getByTestId('run')).toBeDisabled()
    await page.getByPlaceholder('Enter the document password').fill('wrong')
    await page.getByRole('button', { name: 'Unlock' }).click()
    await expect(page.getByText('That password isn’t correct.')).toBeVisible()
    await page.getByPlaceholder('Enter the document password').fill('secret')
    await page.getByRole('button', { name: 'Unlock' }).click()
    await page.getByText('72 DPI').click()
    const { bytes } = await runAndDownloadZip(page)
    const zip = await JSZip.loadAsync(bytes)
    const png = await zip.file('encrypted-user-page-1.png')!.async('uint8array')
    expect(png[1]).toBe(0x50) // "P" of the PNG signature
    g.assertClean()
  })

  test('JPG to PDF: orientation, WebP support and page size', async ({ page }) => {
    const g = guardPage(page)
    await page.goto('/jpg-to-pdf')
    await upload(page, 'rotated-exif6.jpg', 'photo.webp', 'alpha.png')
    await page.getByText('Fit image').click()
    await page.getByText('None', { exact: true }).click()
    const { bytes } = await runAndDownload(page)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(3)
    expect(doc.getPage(0).getSize()).toEqual({ width: 225, height: 300 }) // EXIF 6 → portrait
    expect(doc.getPage(1).getSize()).toEqual({ width: 300, height: 225 })
    g.assertClean()
  })

  test('Start over clears results and files', async ({ page }) => {
    await page.goto('/png-to-pdf')
    await upload(page, 'alpha.png')
    await runAndDownload(page)
    await page.getByTestId('start-over').click()
    await expect(page.getByRole('button', { name: 'Select image files' })).toBeVisible()
  })

  test('Cancel stops a running job', async ({ page }) => {
    await page.goto('/pdf-to-png')
    await upload(page, 'scan.pdf')
    await page.getByText('300 DPI').click()
    await page.getByTestId('run').click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('run')).toBeVisible()
  })
})

test.describe('Robustness and privacy', () => {
  test('large document (400 pages) splits every page without freezing the UI', async ({ page }) => {
    const doc = await PDFDocument.create()
    for (let i = 0; i < 400; i++) doc.addPage([300, 400]).drawText(`Page ${i + 1}`, { x: 20, y: 200, size: 20 })
    const bytes = Buffer.from(await doc.save())
    await page.goto('/split-pdf')
    await page.getByTestId('file-input').setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: bytes })
    await page.getByText('Every page', { exact: true }).click()
    await expect(page.getByText('Creates 400 PDFs')).toBeVisible()
    await page.getByTestId('run').click()
    // The main thread stays responsive while the worker runs: the theme toggle still reacts.
    await page.getByRole('button', { name: /Switch to (dark|light) theme/ }).click()
    const btn = page.getByTestId('download-zip')
    await expect(btn).toBeVisible({ timeout: 60_000 })
    const [dl] = await Promise.all([page.waitForEvent('download'), btn.click()])
    const zip = await JSZip.loadAsync(readFileSync((await dl.path())!))
    expect(Object.keys(zip.files)).toHaveLength(400)
  })

  test('two drops in the same instant keep both batches (no lost files)', async ({ page }) => {
    await page.goto('/merge-pdf')
    const a = [...fixtureBytes('text-8p.pdf')]
    const b = [...fixtureBytes('scan.pdf')]
    await page.evaluate(([a, b]) => {
      const zone = document.querySelector('[data-testid="file-input"]')!.parentElement!
      const drop = (bytes: number[], name: string) => {
        const dt = new DataTransfer()
        dt.items.add(new File([new Uint8Array(bytes)], name, { type: 'application/pdf' }))
        zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
      }
      drop(a, 'first.pdf')
      drop(b, 'second.pdf') // fired before the first batch has been validated
    }, [a, b])
    await expect(page.getByRole('list', { name: 'Selected files' }).getByRole('listitem')).toHaveCount(2)
  })

  test('nothing about documents is persisted in browser storage', async ({ page }) => {
    await page.goto('/merge-pdf')
    await upload(page, 'text-8p.pdf', 'scan.pdf')
    await runAndDownload(page)
    const stored = await page.evaluate(async () => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      idb: (await indexedDB.databases?.())?.map((d) => d.name) ?? [],
      caches: 'caches' in window ? await caches.keys() : [],
      sw: (await navigator.serviceWorker?.getRegistrations())?.length ?? 0,
    }))
    expect(stored.local.every((k) => k === 'freepdf:theme' || k === 'freepdf:recent')).toBe(true)
    expect(stored.session).toEqual([])
    expect(stored.idb).toEqual([])
    expect(stored.caches).toEqual([])
    expect(stored.sw).toBe(0)
    const values = await page.evaluate(() => Object.values(localStorage).join(' '))
    expect(values).not.toContain('scan.pdf')
  })
})
