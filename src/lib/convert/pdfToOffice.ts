/**
 * PDF → Word / Excel / PowerPoint, from what PDF.js reads (text with positions, image placements,
 * rendered pages). Editable with limits: Word gets headings and paragraphs in reading order plus the
 * page's pictures; Excel gets tables rebuilt from text positions; PowerPoint gets each page as a slide
 * picture. Runs in the tab; nothing is uploaded.
 */
import { buildDocx, buildPptx, buildXlsx, type DocxPart } from './ooxml'
import { readPageText, type DocLike, type PageText } from './pdfExport'
import { bodySize, buildBlocks, type Block } from './pdfText'
import { gridFromSpans } from './pdfTables'
import { CancelledError } from '../workerClient'

export interface PageImage { x: number; y: number; w: number; h: number }

type Ops = Record<string, number>
interface OpPage { getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>; getViewport(o: { scale: number }): { transform: number[]; width: number; height: number } }

const mul = (m1: number[], m2: number[]) => {
  const [a1, b1, c1, d1, e1, f1] = m1
  const [a2, b2, c2, d2, e2, f2] = m2
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1]
}

/** Where images are painted on a page (viewport space at scale 1), from its operator list. */
export async function imageRects(page: OpPage, OPS: Ops): Promise<PageImage[]> {
  const vp = page.getViewport({ scale: 1 })
  const { fnArray, argsArray } = await page.getOperatorList()
  const out: PageImage[] = []
  let ctm = [1, 0, 0, 1, 0, 0]
  const stack: number[][] = []
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    const args = argsArray[i] ?? []
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm
    else if (fn === OPS.transform) ctm = mul(ctm, args as number[])
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm)
      const m = args[0] as number[] | null
      if (Array.isArray(m) && m.length === 6) ctm = mul(ctm, m)
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat) {
      // The image fills the unit square under the current matrix.
      const m = mul(vp.transform, ctm)
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]])
      const xs = pts.map((p) => p[0])
      const ys = pts.map((p) => p[1])
      const x = Math.max(0, Math.min(...xs))
      const y = Math.max(0, Math.min(...ys))
      const w = Math.min(vp.width, Math.max(...xs)) - x
      const h = Math.min(vp.height, Math.max(...ys)) - y
      if (w >= 12 && h >= 12) out.push({ x, y, w, h })
    }
  }
  // The same picture drawn twice in one place (masks, duplicates): keep one.
  return out.filter((r, i) => !out.slice(0, i).some((q) => Math.abs(q.x - r.x) < 2 && Math.abs(q.y - r.y) < 2 && Math.abs(q.w - r.w) < 2 && Math.abs(q.h - r.h) < 2))
}

/** Crop part of a rendered page (scale = canvas px per PDF pt). */
export type Cropper = (pageNumber: number, rect: PageImage | null, scale: number) => Promise<{ bytes: Uint8Array; ext: 'png' | 'jpeg' }>

export interface WordOptions { pageBreaks: boolean; images: boolean; title: string }

function align(b: Block, pageWidth: number): 'start' | 'center' | 'end' {
  if (b.lines.length > 3) return 'start'
  const x0 = Math.min(...b.lines.map((l) => l.x0))
  const x1 = Math.max(...b.lines.map((l) => l.x1))
  const mid = (x0 + x1) / 2
  const narrow = x1 - x0 < pageWidth * 0.6
  if (narrow && Math.abs(mid - pageWidth / 2) < pageWidth * 0.04) return 'center'
  if (narrow && !b.rtl && x0 > pageWidth * 0.45) return 'end'
  if (narrow && b.rtl && x1 < pageWidth * 0.55) return 'end'
  return 'start'
}

export async function pdfToDocx(doc: DocLike, pages: number[], o: WordOptions & { OPS: Ops; crop: Cropper; signal?: AbortSignal; onProgress?: (f: number) => void }): Promise<{ bytes: Uint8Array; images: number; text: boolean }> {
  const read: { text: PageText; images: PageImage[] }[] = []
  for (let k = 0; k < pages.length; k++) {
    if (o.signal?.aborted) throw new CancelledError()
    const text = await readPageText(doc, pages[k])
    const images = o.images ? await imageRects((await doc.getPage(pages[k])) as unknown as OpPage, o.OPS) : []
    read.push({ text, images })
    o.onProgress?.(((k + 1) / pages.length) * 0.6)
  }
  const body = bodySize(read.flatMap((r) => r.text.lines))
  const parts: DocxPart[] = []
  let imageCount = 0
  const first = read[0].text
  // Margins: from the text's extent on the pages (within sensible bounds).
  const allLines = read.flatMap((r) => r.text.lines)
  const minX = Math.min(...allLines.map((l) => l.x0), first.width * 0.12)
  const maxX = Math.max(...allLines.map((l) => l.x1), first.width * 0.88)
  const side = (v: number) => Math.min(108, Math.max(36, v))
  const margins = { top: 54, bottom: 54, left: side(minX), right: side(first.width - maxX) }

  for (let k = 0; k < read.length; k++) {
    const { text, images } = read[k]
    if (k > 0 && o.pageBreaks) parts.push({ type: 'pageBreak' })
    // Text blocks and pictures in reading order (top of the page first). Line y is a baseline in user
    // space (y up); image y is from the top in viewport space.
    const items: { top: number; part: () => Promise<DocxPart> }[] = []
    for (const b of buildBlocks(text.lines, body)) {
      const top = text.height - Math.max(...b.lines.map((l) => l.y + l.size))
      items.push({ top, part: async () => ({ type: 'p', kind: b.kind, text: b.text, size: b.size, rtl: b.rtl, align: align(b, text.width) }) })
    }
    for (const img of images) {
      items.push({
        top: img.y,
        part: async () => {
          const scale = Math.min(3, Math.max(1, 1600 / Math.max(img.w, img.h)))
          const c = await o.crop(text.number, img, scale)
          imageCount++
          return { type: 'image', bytes: c.bytes, ext: c.ext, width: img.w, height: img.h }
        },
      })
    }
    items.sort((a, b) => a.top - b.top)
    for (const it of items) {
      if (o.signal?.aborted) throw new CancelledError()
      parts.push(await it.part())
    }
    o.onProgress?.(0.6 + ((k + 1) / read.length) * 0.35)
  }
  const hasText = allLines.some((l) => l.text.trim())
  const bytes = await buildDocx(parts, { title: o.title, pageWidth: first.width, pageHeight: first.height, margins, bodySize: Math.max(8, Math.min(14, body)) })
  return { bytes, images: imageCount, text: hasText }
}

export interface ExcelOptions { perPage: boolean; numbers: boolean; title: string; sheetLabel: (n: number) => string }

export async function pdfToXlsx(doc: DocLike, pages: number[], o: ExcelOptions & { signal?: AbortSignal; onProgress?: (f: number) => void }): Promise<{ bytes: Uint8Array; rows: number }> {
  const sheets: { name: string; grid: ReturnType<typeof gridFromSpans> }[] = []
  let all: ReturnType<typeof gridFromSpans> | null = null
  let rows = 0
  for (let k = 0; k < pages.length; k++) {
    if (o.signal?.aborted) throw new CancelledError()
    const page = await readPageText(doc, pages[k])
    const grid = gridFromSpans(page.spans)
    rows += grid.rows.length
    if (o.perPage) sheets.push({ name: o.sheetLabel(pages[k]), grid })
    else if (!all) all = grid
    else {
      // One sheet: pages stacked; columns widened to the widest page.
      const n = Math.max(all.widths.length, grid.widths.length)
      const pad = (r: (string | null)[]) => [...r, ...Array(n - r.length).fill(null)]
      all = { rows: [...all.rows.map(pad), ...grid.rows.map(pad)], widths: Array.from({ length: n }, (_, i) => Math.max(all!.widths[i] ?? 0, grid.widths[i] ?? 0)), rtl: all.rtl }
    }
    o.onProgress?.(((k + 1) / pages.length) * 0.9)
  }
  if (!o.perPage && all) sheets.push({ name: o.title, grid: all })
  const bytes = await buildXlsx(sheets, { title: o.title, numbers: o.numbers })
  return { bytes, rows }
}

export async function pdfToPptx(doc: DocLike, pages: number[], o: { title: string; dpi: number; crop: Cropper; signal?: AbortSignal; onProgress?: (f: number) => void }): Promise<Uint8Array> {
  const slides = []
  for (let k = 0; k < pages.length; k++) {
    if (o.signal?.aborted) throw new CancelledError()
    const page = await doc.getPage(pages[k])
    const vp = page.getViewport({ scale: 1 })
    page.cleanup()
    const img = await o.crop(pages[k], null, o.dpi / 72)
    slides.push({ image: img.bytes, ext: img.ext, width: vp.width, height: vp.height })
    o.onProgress?.(((k + 1) / pages.length) * 0.95)
  }
  return buildPptx(slides, { title: o.title })
}
