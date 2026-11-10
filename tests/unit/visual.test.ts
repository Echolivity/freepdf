import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { mergePdfs, organizePdf, removePages, rotatePdf } from '../../src/lib/pdf/organize'
import { imagesToPdf } from '../../src/lib/pdf/images'
import { fixture } from './helpers'
import { meanDiff, renderPage } from './render'

/** Render-and-compare: output pages must look exactly like the source pages they came from. */
describe('visual fidelity (render and compare)', () => {
  it('remove / organize / merge produce pixel-identical pages', async () => {
    const text = fixture('text-8p.pdf')
    const scan = fixture('scan.pdf')
    const removed = await removePages({ name: 't', bytes: text }, [0, 1])
    expect(meanDiff(await renderPage(removed, 1), await renderPage(text, 3))).toBe(0)

    const organized = await organizePdf({ name: 's', bytes: fixture('structured.pdf') }, [{ index: 2 }, { index: 0 }])
    expect(meanDiff(await renderPage(organized, 1), await renderPage(fixture('structured.pdf'), 3))).toBe(0)

    const merged = await mergePdfs([{ name: 't', bytes: text }, { name: 's', bytes: scan }])
    expect(meanDiff(await renderPage(merged, 9), await renderPage(scan, 1))).toBeLessThan(0.01)
  }, 60_000)

  it('rotation turns the rendered page, not just a flag', async () => {
    const text = fixture('text-8p.pdf')
    const rotated = await rotatePdf({ name: 't', bytes: text }, 90)
    const a = await renderPage(text, 1, 0.5)
    const b = await renderPage(rotated, 1, 0.5)
    expect([b.width, b.height]).toEqual([a.height, a.width])
  })

  it('images to PDF keeps transparency over a white page (PNG alpha)', async () => {
    const pdf = await imagesToPdf([{ name: 'a.png', kind: 'png', bytes: fixture('alpha.png') }], { pageSize: 'fit', orientation: 'auto', margin: 0 })
    const r = await renderPage(pdf, 1, 96 / 72)
    // alpha.png is (30,60,200) at 50% alpha → blended over white ≈ (142,157,227)
    const mid = ((r.height >> 1) * r.width + (r.width >> 1)) * 4
    expect(Math.abs(r.data[mid] - 142)).toBeLessThan(6)
    expect(Math.abs(r.data[mid + 2] - 227)).toBeLessThan(6)
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1)
  })
})
