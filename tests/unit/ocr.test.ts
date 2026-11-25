import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, rgb } from 'pdf-lib'
import { setFontLoader } from '../../src/lib/pdf/fonts'
import { addTextLayer, type LayerWord } from '../../src/lib/ocr/textLayer'
import { ocrToPageText, wordsFromBlocks } from '../../src/lib/ocr/pageText'
import { OCR_VERSION } from '../../src/lib/ocr/engine'
import { readPageText, type DocLike } from '../../src/lib/convert/pdfExport'
import { meanDiff, openNode, renderPage } from './render'

const fontDir = join(process.cwd(), 'node_modules', '@expo-google-fonts', 'ibm-plex-sans-arabic')
beforeAll(() => {
  setFontLoader(async (f) => new Uint8Array(readFileSync(join(fontDir, f.includes('Bold') ? '700Bold/IBMPlexSansArabic_700Bold.ttf' : '400Regular/IBMPlexSansArabic_400Regular.ttf'))))
})

async function text(bytes: Uint8Array, n = 1) {
  const { doc, close } = await openNode(bytes)
  try { return await readPageText(doc as unknown as DocLike, n) } finally { await close() }
}

describe('OCR text layer', () => {
  it('pins the tesseract.js version served from /ocr', () => {
    expect(JSON.parse(readFileSync(join(process.cwd(), 'node_modules', 'tesseract.js', 'package.json'), 'utf8')).version).toBe(OCR_VERSION)
  })

  it('adds invisible, selectable English and Arabic words without changing how the page looks', async () => {
    const src = await PDFDocument.create()
    const page = src.addPage([400, 300])
    page.drawRectangle({ x: 40, y: 200, width: 150, height: 20, color: rgb(0.2, 0.2, 0.2) }) // stands in for scanned ink
    const before = await src.save()
    const word = (t: string, x: number, y: number, w: number): LayerWord => ({ text: t, m: [1, 0, 0, 1, x, y], size: 14, width: w })
    const out = await addTextLayer({ name: 'scan.pdf', bytes: before }, [{ index: 0, words: [word('Invoice', 40, 205, 70), word('2026', 120, 205, 40), word('الإجمالي', 250, 120, 80)] }])
    const t = await text(out)
    expect(t.spans.map((s) => s.str).join(' ')).toContain('Invoice')
    const lines = t.lines.map((l) => l.text)
    expect(lines.some((l) => /Invoice\s+2026/.test(l))).toBe(true)
    expect(lines).toContain('الإجمالي') // no ligatures: every glyph maps to one letter, so the word comes back intact
    // Positioned where the scan has the word, and stretched to its width.
    const inv = t.spans.find((s) => s.str.includes('Invoice'))!
    expect(inv.x).toBeCloseTo(40, 0)
    expect(inv.y).toBeCloseTo(300 - 205, 0)
    // Invisible: renders exactly like the original.
    expect(meanDiff(await renderPage(before, 1, 1), await renderPage(out, 1, 1))).toBe(0)
  })

  it('places words correctly on a rotated page', async () => {
    const src = await PDFDocument.create()
    const page = src.addPage([300, 400])
    page.setRotation({ type: 'degrees', angle: 90 } as never)
    const bytes = await src.save()
    // Displayed page is 400 × 300; a word at displayed (50, 60) baseline. For /Rotate 90 PDF.js maps
    // displayed (x, y) to user space (y, x); the baseline runs along +y in user space, "up" along -x… here
    // we give the matrix the way the tool computes it from the viewport.
    const out = await addTextLayer({ name: 'r.pdf', bytes }, [{ index: 0, words: [{ text: 'Rotated', m: [0, 1, -1, 0, 60, 50], size: 12, width: 50 }] }])
    const t = await text(out)
    const s = t.spans.find((x) => x.str.includes('Rotated'))!
    expect(Math.round(s.angle)).toBe(0) // upright on the displayed page
    expect(s.x).toBeCloseTo(50, 0)
    expect(s.y).toBeCloseTo(60, 0)
  })
})

describe('OCR results to page text', () => {
  const blocks = [{ paragraphs: [{ lines: [
    { words: [{ text: 'Date', confidence: 95, bbox: { x0: 100, y0: 100, x1: 160, y1: 130 } }, { text: 'Balance', confidence: 90, bbox: { x0: 400, y0: 100, x1: 520, y1: 130 } }],
      baseline: { x0: 100, y0: 128, x1: 520, y1: 128 }, rowAttributes: { rowHeight: 40, ascenders: 8, descenders: 8 }, bbox: { x0: 100, y0: 100, x1: 520, y1: 130 } },
    { words: [{ text: ' ', confidence: 0, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } }, { text: '01/03/2026', confidence: 80, bbox: { x0: 100, y0: 160, x1: 260, y1: 190 } }],
      baseline: null, rowAttributes: null, bbox: { x0: 100, y0: 160, x1: 260, y1: 190 } },
  ] }] }]
  it('keeps each word with its baseline and size, and converts pixels to points', () => {
    const r = wordsFromBlocks(blocks, 2480, 3508)
    expect(r.words.map((w) => w.text)).toEqual(['Date', 'Balance', '01/03/2026'])
    expect(r.words[0]).toMatchObject({ baseline: 128, size: 32 })
    expect(r.words[2]).toMatchObject({ baseline: 190, size: 24 }) // no baseline: bottom of the box
    expect(r.confidence).toBeCloseTo((95 + 90 + 80) / 3)
    const t = ocrToPageText(r, 1, 300 / 72)
    expect(t.width).toBeCloseTo(595.2, 1)
    expect(t.spans[0]).toMatchObject({ str: 'Date', angle: 0 })
    expect(t.spans[0].x).toBeCloseTo(24, 1)
    expect(t.spans[0].y).toBeCloseTo(30.72, 1)
    expect(t.lines.map((l) => l.text)).toEqual(['Date\tBalance', '01/03/2026'])
  })
})
