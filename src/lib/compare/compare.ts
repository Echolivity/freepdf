import type { PDFDocumentProxy } from '../render/pdfjs'
import { diffTokens, intern, splitWords, type DiffRun } from './diff'
import { CancelledError } from '../workerClient'

/** A word with its page (0-based) and approximate box in PDF user space [x, y, w, h], if known. */
export interface Word {
  text: string
  page: number
  box: [number, number, number, number] | null
}

export interface PageInfo {
  width: number
  height: number
}

/** Extract words page by page with PDF.js (text is read, never executed or sent anywhere). */
export async function extractWords(
  doc: PDFDocumentProxy,
  opts: { signal?: AbortSignal; onPage?: (done: number, total: number) => void } = {},
): Promise<{ words: Word[]; pages: PageInfo[] }> {
  const words: Word[] = []
  const pages: PageInfo[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    if (opts.signal?.aborted) throw new CancelledError()
    const page = await doc.getPage(p)
    try {
      const vp = page.getViewport({ scale: 1 })
      pages.push({ width: vp.width, height: vp.height })
      const content = await page.getTextContent()
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const [a, b, c, d, e, f] = item.transform as number[]
        const upright = Math.abs(b) < 1e-3 && Math.abs(c) < 1e-3 && a > 0
        const fontH = Math.abs(d) || item.height || 10
        const len = item.str.length
        for (const w of splitWords(item.str)) {
          let box: Word['box'] = null
          if (upright && item.width > 0) {
            const from = item.dir === 'rtl' ? 1 - w.end / len : w.start / len
            box = [e + item.width * from, f - fontH * 0.22, (item.width * (w.end - w.start)) / len, fontH * 1.2]
          }
          words.push({ text: w.word, page: p - 1, box })
        }
      }
    } finally {
      page.cleanup()
    }
    opts.onPage?.(p, doc.numPages)
  }
  return { words, pages }
}

export interface TextChange {
  removed: string
  added: string
  /** Pages (0-based) the change touches in A and in B. */
  pageA: number | null
  pageB: number | null
}

export interface Comparison {
  pagesA: PageInfo[]
  pagesB: PageInfo[]
  wordsA: Word[]
  wordsB: Word[]
  /** Per word: true if it differs from the other document. */
  removedA: Uint8Array
  addedB: Uint8Array
  changes: TextChange[]
  removedCount: number
  addedCount: number
  /** Page numbers (0-based, paired by position) with any text change, size change, or missing counterpart. */
  changedPages: number[]
  /** Pairs whose page size differs. */
  sizeChanged: number[]
  /** Neither document has any extractable text (scans): only the visual comparison applies. */
  noText: boolean
}

const MAX_SNIPPET = 160

/** Build the comparison from extracted words and diff runs (computed in a worker). */
export function buildComparison(a: { words: Word[]; pages: PageInfo[] }, b: { words: Word[]; pages: PageInfo[] }, runs: DiffRun[]): Comparison {
  const removedA = new Uint8Array(a.words.length)
  const addedB = new Uint8Array(b.words.length)
  const changes: TextChange[] = []
  let removedCount = 0
  let addedCount = 0
  const changed = new Set<number>()
  // Merge a deletion immediately followed by an insertion into one "replaced" change.
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]
    if (r.kind === 0) continue
    let del: DiffRun | null = r.kind === 1 ? r : null
    let ins: DiffRun | null = r.kind === 2 ? r : null
    if (del && runs[i + 1]?.kind === 2) ins = runs[++i]
    const remWords = del ? a.words.slice(del.aStart, del.aEnd) : []
    const addWords = ins ? b.words.slice(ins.bStart, ins.bEnd) : []
    if (del) for (let k = del.aStart; k < del.aEnd; k++) { removedA[k] = 1; changed.add(a.words[k].page) }
    if (ins) for (let k = ins.bStart; k < ins.bEnd; k++) { addedB[k] = 1; changed.add(b.words[k].page) }
    removedCount += remWords.length
    addedCount += addWords.length
    const clip = (ws: Word[]) => {
      const s = ws.map((w) => w.text).join(' ')
      return s.length > MAX_SNIPPET ? s.slice(0, MAX_SNIPPET) + '…' : s
    }
    changes.push({ removed: clip(remWords), added: clip(addWords), pageA: remWords[0]?.page ?? null, pageB: addWords[0]?.page ?? null })
    del = ins = null
  }
  const sizeChanged: number[] = []
  const n = Math.max(a.pages.length, b.pages.length)
  for (let i = 0; i < n; i++) {
    const pa = a.pages[i]
    const pb = b.pages[i]
    if (!pa || !pb) changed.add(i)
    else if (Math.abs(pa.width - pb.width) > 1 || Math.abs(pa.height - pb.height) > 1) { sizeChanged.push(i); changed.add(i) }
  }
  return {
    pagesA: a.pages,
    pagesB: b.pages,
    wordsA: a.words,
    wordsB: b.words,
    removedA,
    addedB,
    changes,
    removedCount,
    addedCount,
    changedPages: [...changed].sort((x, y) => x - y),
    sizeChanged,
    noText: !a.words.length && !b.words.length,
  }
}

export function tokenIds(a: Word[], b: Word[]) {
  return intern(a.map((w) => w.text), b.map((w) => w.text))
}

export { diffTokens }
