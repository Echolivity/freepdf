/**
 * OCR over a PDF's pages (main thread: PDF.js renders, tesseract.js recognises in its own worker).
 * For each page: render at `dpi`, recognise, and return both the page's text (PageText, for text
 * exports and the converters) and the invisible text-layer words in the page's user space (for
 * searchable PDFs). Pages that already have a text layer can be skipped and read directly instead.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { readPageText, type DocLike, type PageText } from '../convert/pdfExport'
import { releaseCanvas, renderPage } from '../render/pdfjs'
import { CancelledError } from '../workerClient'
import type { Ocr } from './engine'
import { ocrToPageText } from './pageText'
import type { LayerWord } from './textLayer'

export interface OcrPage {
  /** 1-based. */
  number: number
  text: PageText
  /** Text-layer words for a searchable PDF (empty for skipped pages). */
  layer: LayerWord[]
  /** Mean word confidence 0–100, or null when the page was read from its existing text. */
  confidence: number | null
  /** The page already had text and wasn't recognised. */
  skipped: boolean
}

/** Words below this confidence are usually specks, lines or texture read as text. */
const MIN_CONFIDENCE = 20

export async function pageHasText(doc: PDFDocumentProxy, n: number): Promise<boolean> {
  const page = await doc.getPage(n)
  try {
    const c = await page.getTextContent()
    return c.items.some((i) => 'str' in i && i.str.trim().length > 0)
  } finally {
    page.cleanup()
  }
}

export async function ocrPages(
  doc: PDFDocumentProxy,
  pages: number[],
  ocr: Ocr,
  o: { dpi?: number; skipWithText: boolean; signal?: AbortSignal; onPage?: (done: number, total: number, n: number) => void },
): Promise<OcrPage[]> {
  const out: OcrPage[] = []
  const dpi = o.dpi ?? 300
  for (let k = 0; k < pages.length; k++) {
    const n = pages[k]
    if (o.signal?.aborted) throw new CancelledError()
    o.onPage?.(k, pages.length, n)
    if (o.skipWithText && (await pageHasText(doc, n))) {
      out.push({ number: n, text: await readPageText(doc as unknown as DocLike, n), layer: [], confidence: null, skipped: true })
      continue
    }
    const { canvas, scaleUsed } = await renderPage(doc, n, dpi / 72)
    let result
    try {
      result = await ocr.recognise(canvas)
    } finally {
      releaseCanvas(canvas)
    }
    if (o.signal?.aborted) throw new CancelledError()
    result = { ...result, words: result.words.filter((w) => w.confidence >= MIN_CONFIDENCE) }
    const page = await doc.getPage(n)
    const vp = page.getViewport({ scale: scaleUsed })
    page.cleanup()
    const layer: LayerWord[] = []
    for (const w of result.words) {
      // Baseline ends and a point one type size above the start, mapped to the page's user space; this
      // carries any page rotation and offset into the word's text matrix.
      const [ax, ay] = vp.convertToPdfPoint(w.x0, w.baseline)
      const [bx, by] = vp.convertToPdfPoint(w.x1, w.baseline)
      const [ux, uy] = vp.convertToPdfPoint(w.x0, w.baseline - w.size)
      const len = Math.hypot(bx - ax, by - ay)
      const size = Math.hypot(ux - ax, uy - ay)
      if (!(len > 0) || !(size > 0)) continue
      layer.push({ text: w.text, m: [(bx - ax) / len, (by - ay) / len, (ux - ax) / size, (uy - ay) / size, ax, ay], size, width: len })
    }
    const confidence = result.words.length ? result.words.reduce((s, w) => s + w.confidence, 0) / result.words.length : 0
    out.push({ number: n, text: ocrToPageText(result, n, scaleUsed), layer, confidence, skipped: false })
  }
  o.onPage?.(pages.length, pages.length, pages[pages.length - 1])
  return out
}
