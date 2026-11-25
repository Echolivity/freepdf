/**
 * Page text for the converters, with OCR for scanned pages: a page's own text when it has any, and
 * otherwise (if allowed) the text OCR recognises on it. The OCR engine (English and Arabic) starts on
 * the first page that needs it, so documents with text never load it; dispose() stops it.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { readPageText, type DocLike, type PageText } from '../convert/pdfExport'
import type { Ocr } from './engine'

export type ReadText = (n: number) => Promise<PageText & { ocr?: boolean }>

export interface TextReader {
  read: ReadText
  /** Pages recognised with OCR so far. */
  readonly ocrPages: number
  dispose(): Promise<void>
}

export function textReader(doc: PDFDocumentProxy, o: { ocr: boolean; signal?: AbortSignal; onOcr?: (stage: 'loading' | 'page', n: number) => void }): TextReader {
  let engine: Promise<Ocr> | null = null
  let count = 0
  const stop = () => { void engine?.then((e) => e.terminate()).catch(() => {}) }
  o.signal?.addEventListener('abort', stop)
  return {
    async read(n) {
      const own = await readPageText(doc as unknown as DocLike, n)
      if (own.spans.length || !o.ocr) return own
      if (!engine) {
        o.onOcr?.('loading', n)
        engine = import('./engine').then(({ createOcr }) => createOcr(['ara', 'eng']))
      }
      const ocr = await engine
      o.onOcr?.('page', n)
      const { ocrPages } = await import('./run')
      const [page] = await ocrPages(doc, [n], ocr, { skipWithText: false, signal: o.signal })
      count++
      return { ...page.text, ocr: true }
    },
    get ocrPages() { return count },
    async dispose() {
      o.signal?.removeEventListener('abort', stop)
      if (engine) await (await engine.catch(() => null))?.terminate().catch(() => {})
    },
  }
}
