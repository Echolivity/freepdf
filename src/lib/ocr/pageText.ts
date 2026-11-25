/**
 * OCR results as FreePDF's PageText, so everything that reads text from a page (PDF to text, Word,
 * Excel, bank statements) can read a scanned page the same way. Pure functions, unit-tested.
 */
import type { PageText, Span } from '../convert/pdfExport'
import { buildLines, type TextItem } from '../convert/pdfText'

/** One recognised word, in pixels of the image that was recognised (top-left origin). */
export interface OcrWord {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
  /** Baseline height at this word (y, pixels). */
  baseline: number
  /** Estimated font size (pixels). */
  size: number
  /** 0–100. */
  confidence: number
}

export interface OcrResult {
  /** Size of the recognised image (pixels). */
  width: number
  height: number
  words: OcrWord[]
  /** Mean word confidence, 0–100 (0 when nothing was found). */
  confidence: number
}

interface RawLine {
  words: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[]
  baseline?: { x0: number; y0: number; x1: number; y1: number } | null
  rowAttributes?: { rowHeight?: number; ascenders?: number; descenders?: number } | null
  bbox: { x0: number; y0: number; x1: number; y1: number }
}
interface RawBlock { paragraphs: { lines: RawLine[] }[] }

/** Words from tesseract.js `blocks` output, with each word's baseline and a font-size estimate. */
export function wordsFromBlocks(blocks: RawBlock[] | null | undefined, width: number, height: number): OcrResult {
  const words: OcrWord[] = []
  for (const b of blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
    const bl = l.baseline
    const hasBase = bl && Number.isFinite(bl.y0) && Number.isFinite(bl.y1) && bl.x1 !== bl.x0
    // Row height covers ascenders to descenders; type size is about 0.8 of that. Without row
    // attributes, the line box height is the next best thing.
    const rowH = l.rowAttributes?.rowHeight && l.rowAttributes.rowHeight > 0 ? l.rowAttributes.rowHeight : l.bbox.y1 - l.bbox.y0
    const size = Math.max(4, rowH * 0.8)
    for (const w of l.words) {
      const text = w.text.trim()
      if (!text) continue
      const cx = (w.bbox.x0 + w.bbox.x1) / 2
      const baseline = hasBase ? bl!.y0 + ((bl!.y1 - bl!.y0) * (cx - bl!.x0)) / (bl!.x1 - bl!.x0) : w.bbox.y1 - (l.rowAttributes?.descenders ?? 0)
      words.push({ text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, baseline, size, confidence: w.confidence })
    }
  }
  const confidence = words.length ? words.reduce((s, w) => s + w.confidence, 0) / words.length : 0
  return { width, height, words, confidence }
}

/**
 * PageText for page `number` from an OCR result of that page rendered at `scale` (pixels per point).
 * Coordinates are of the page as displayed (its rotation applied), like readPageText's spans.
 */
export function ocrToPageText(r: OcrResult, number: number, scale: number): PageText {
  const H = r.height / scale
  const spans: Span[] = r.words.map((w) => ({ str: w.text, x: w.x0 / scale, y: w.baseline / scale, size: w.size / scale, angle: 0, width: (w.x1 - w.x0) / scale }))
  const items: TextItem[] = r.words.map((w) => ({ str: w.text, x: w.x0 / scale, y: H - w.baseline / scale, width: (w.x1 - w.x0) / scale, size: w.size / scale, upright: true }))
  return { number, width: r.width / scale, height: H, lines: buildLines(items), spans }
}
