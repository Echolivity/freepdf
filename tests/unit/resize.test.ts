import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib'
import { resizePdf, planPage, PAPER, type ResizeOptions } from '../../src/lib/pdf/resize'
import { fixture, numberedPdf, qpdfCheck } from './helpers'
import { meanDiff, pageTexts, renderPage, visualSizes } from './render'

const A4 = PAPER.a4
const LETTER = PAPER.letter
const opts = (o: Partial<ResizeOptions> = {}): ResizeOptions => ({ width: A4[0], height: A4[1], orientation: 'auto', mode: 'fit', margin: 0, indices: null, ...o })
const run = (bytes: Uint8Array, o: Partial<ResizeOptions> = {}) => resizePdf({ name: 'in.pdf', bytes }, opts(o))
const close = (a: number, b: number, tol = 0.6) => Math.abs(a - b) <= tol

function annotRects(doc: PDFDocument, page: number): number[][] {
  const annots = doc.getPage(page).node.Annots()
  if (!annots) return []
  return Array.from({ length: annots.size() }, (_, i) => {
    const r = (annots.lookup(i) as PDFDict).lookup(PDFName.of('Rect'), PDFArray)
    return [0, 1, 2, 3].map((k) => (r.lookup(k) as PDFNumber).asNumber())
  })
}

describe('resize: geometry', () => {
  it('fit scales uniformly and centres', () => {
    const p = planPage({ x: 0, y: 0, width: A4[0], height: A4[1] }, 0, { ...opts(), width: LETTER[0], height: LETTER[1] })
    const s = Math.min(LETTER[0] / A4[0], LETTER[1] / A4[1])
    expect(p.scale).toBeCloseTo(s, 6)
    expect([p.width, p.height]).toEqual([LETTER[0], LETTER[1]])
    expect(p.matrix[4]).toBeCloseTo((LETTER[0] - s * A4[0]) / 2, 6)
    expect(p.matrix[5]).toBeCloseTo((LETTER[1] - s * A4[1]) / 2, 6)
  })

  it('handles offset boxes and rotated pages', () => {
    // A landscape-looking page stored portrait with /Rotate 90 and a non-zero origin.
    const p = planPage({ x: 50, y: 30, width: 595, height: 842 }, 90, opts())
    // Visually landscape → target becomes landscape A4; stored unrotated, so width/height swap back.
    expect([p.width, p.height].map(Math.round)).toEqual([595, 842])
    expect(p.matrix[4]).toBeCloseTo((p.width - p.scale * 595) / 2 - p.scale * 50, 6)
  })

  it('rejects margins that leave no room', () => {
    expect(() => planPage({ x: 0, y: 0, width: 100, height: 100 }, 0, opts({ margin: 400 }))).toThrow()
  })
})

describe('resize: documents', () => {
  it('returns the original bytes when nothing changes', async () => {
    const src = fixture('text-8p.pdf') // already A4
    const out = await run(src, { mode: 'canvas' })
    expect(out).toBe(src)
  })

  it('mixed sizes and rotations all end up A4, keeping orientation per page', async () => {
    const src = fixture('rich.pdf') // A4, A4 landscape via /Rotate 90, Letter, A5
    const out = await run(src)
    expect(qpdfCheck(out)).toBe(true)
    const before = await visualSizes(src)
    const after = await visualSizes(out)
    after.forEach(([w, h], i) => {
      const landscape = before[i][0] > before[i][1]
      const [tw, th] = landscape ? [A4[1], A4[0]] : [A4[0], A4[1]]
      expect(close(w, tw) && close(h, th), `page ${i + 1}: ${w}×${h}`).toBe(true)
    })
    // Rotation is kept as a page attribute (content is not rasterised or re-embedded).
    const doc = await PDFDocument.load(out)
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual((await PDFDocument.load(src)).getPages().map((p) => p.getRotation().angle))
  })

  it('keeps text, form fields, bookmarks and annotations', async () => {
    const src = fixture('rich.pdf')
    const out = await run(src, { width: LETTER[0], height: LETTER[1], margin: 36 })
    expect(await pageTexts(out)).toEqual(await pageTexts(src))
    const a = await PDFDocument.load(src)
    const b = await PDFDocument.load(out)
    expect(b.getForm().getFields().map((f) => f.getName())).toEqual(a.getForm().getFields().map((f) => f.getName()))
    expect(b.getPages().map((p) => p.node.Annots()?.size() ?? 0)).toEqual(a.getPages().map((p) => p.node.Annots()?.size() ?? 0))
    expect(b.catalog.has(PDFName.of('Outlines'))).toBe(true)
    expect(b.getPageCount()).toBe(a.getPageCount())
  })

  it('moves annotation rectangles with the content', async () => {
    const src = fixture('structured.pdf') // A4 with link annotations
    const out = await run(src, { width: PAPER.a3[0], height: PAPER.a3[1] })
    const s = Math.min(PAPER.a3[0] / 595.28, PAPER.a3[1] / 841.89)
    const box = (await PDFDocument.load(src)).getPage(0).getCropBox()
    const tx = (PAPER.a3[0] - s * box.width) / 2 - s * box.x
    const ty = (PAPER.a3[1] - s * box.height) / 2 - s * box.y
    const before = annotRects(await PDFDocument.load(src), 0)
    const after = annotRects(await PDFDocument.load(out), 0)
    expect(after.length).toBe(before.length)
    before.forEach((r, i) => {
      expect(after[i][0]).toBeCloseTo(s * r[0] + tx, 1)
      expect(after[i][1]).toBeCloseTo(s * r[1] + ty, 1)
      expect(after[i][2]).toBeCloseTo(s * r[2] + tx, 1)
      expect(after[i][3]).toBeCloseTo(s * r[3] + ty, 1)
    })
  })

  it('scaled pages render like the original at the matching zoom (vector, not raster)', async () => {
    const src = fixture('text-8p.pdf')
    const out = await run(src, { width: PAPER.a3[0], height: PAPER.a3[1] })
    const s = Math.min(PAPER.a3[0] / 595.28, PAPER.a3[1] / 841.89)
    const a = await renderPage(src, 1, 0.5 * s)
    const b = await renderPage(out, 1, 0.5)
    // Same pixel grid ±1 px from rounding; crop both to the common area.
    const w = Math.min(a.width, b.width)
    const h = Math.min(a.height, b.height)
    const crop = (r: typeof a) => {
      const d = new Uint8ClampedArray(w * h * 4)
      for (let y = 0; y < h; y++) d.set(r.data.subarray(y * r.width * 4, y * r.width * 4 + w * 4), y * w * 4)
      return { width: w, height: h, data: d }
    }
    expect(meanDiff(crop(a), crop(b))).toBeLessThan(3)
  }, 60_000)

  it('canvas mode keeps content size and clips what falls outside', async () => {
    const src = fixture('text-8p.pdf')
    const out = await run(src, { mode: 'canvas', width: PAPER.a5[0], height: PAPER.a5[1] })
    const sizes = await visualSizes(out)
    expect(sizes.every(([w, h]) => close(w, PAPER.a5[0]) && close(h, PAPER.a5[1]))).toBe(true)
    // Centre of the page renders identically to the centre of the original.
    const a = await renderPage(src, 1, 1)
    const b = await renderPage(out, 1, 1)
    const offX = Math.round((a.width - b.width) / 2)
    const offY = Math.round((a.height - b.height) / 2)
    let diff = 0
    for (let y = 100; y < 200; y++) for (let x = 50; x < 250; x++) {
      const ia = ((y + offY) * a.width + x + offX) * 4
      const ib = (y * b.width + x) * 4
      diff += Math.abs(a.data[ia] - b.data[ib])
    }
    expect(diff / (100 * 200)).toBeLessThan(4)
  }, 60_000)

  it('resizes only the selected pages', async () => {
    const src = fixture('rich.pdf')
    const out = await run(src, { indices: [2], width: A4[0], height: A4[1] })
    const before = await visualSizes(src)
    const after = await visualSizes(out)
    expect(after[0]).toEqual(before[0])
    expect(after[1]).toEqual(before[1])
    expect(close(after[2][0], A4[0]) && close(after[2][1], A4[1])).toBe(true)
    expect(after[3]).toEqual(before[3])
  })

  it('keeps Arabic text extractable', async () => {
    const src = fixture('arabic.pdf')
    const out = await run(src, { width: LETTER[0], height: LETTER[1] })
    const [t1] = await pageTexts(out)
    expect(t1).toEqual((await pageTexts(src))[0])
    expect(/[؀-ۿ]/.test(t1)).toBe(true)
  })

  it('rejects encrypted and broken files with a clear message', async () => {
    await expect(run(fixture('encrypted-user.pdf'))).rejects.toMatchObject({ key: 'err.encrypted' })
    await expect(run(fixture('garbage.pdf'))).rejects.toHaveProperty('key')
    await expect(run(fixture('text-8p.pdf'), { width: 20_000 })).rejects.toMatchObject({ key: 'err.resizeSize' })
  })

  it('handles an 800-page document', async () => {
    const src = await numberedPdf(800)
    const t0 = performance.now()
    const out = await run(src, { width: LETTER[0], height: LETTER[1], orientation: 'portrait' })
    const ms = performance.now() - t0
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(800)
    expect(doc.getPages().every((p) => close(p.getMediaBox().width, LETTER[0]) && close(p.getMediaBox().height, LETTER[1]))).toBe(true)
    expect(qpdfCheck(out)).toBe(true)
    expect(ms).toBeLessThan(15_000)
  }, 60_000)
})
