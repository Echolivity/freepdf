/**
 * PDF → Word / Excel / PowerPoint, from what PDF.js reads (text with positions, image placements,
 * rendered pages). Editable with limits: Word gets headings, paragraphs and tables in reading order plus
 * the page's pictures; Excel gets tables rebuilt from text positions; PowerPoint gets each page as a slide
 * picture. Runs in the tab; nothing is uploaded.
 */
import { buildDocx, buildPptx, buildXlsx, type DocxPart, type Slide, type SlideText } from './ooxml'
import { readPageText, type DocLike, type PageText } from './pdfExport'
import { bodySize, buildBlocks, isRtlText, type Block } from './pdfText'
import { gridFromSpans, rowsFromSpans } from './pdfTables'
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

export interface WordOptions { pageBreaks: boolean; images: boolean; tables?: boolean; title: string }

/**
 * Table runs in a page's blocks: two or more consecutive one-line blocks with column gaps whose
 * rebuilt grid has at least two columns and two filled rows. Returned as [first, last] block indexes
 * with the grid built from the page's positioned text within those lines.
 */
export function findTables(blocks: Block[], text: PageText): { from: number; to: number; grid: ReturnType<typeof gridFromSpans>; size: number }[] {
  const out: { from: number; to: number; grid: ReturnType<typeof gridFromSpans>; size: number }[] = []
  const tabular = (b: Block) => b.lines.length === 1 && b.lines[0].text.includes('\t')
  let i = 0
  while (i < blocks.length) {
    if (!tabular(blocks[i])) { i++; continue }
    let j = i
    while (j + 1 < blocks.length && tabular(blocks[j + 1])) j++
    if (j > i) {
      const lines = blocks.slice(i, j + 1).map((b) => b.lines[0])
      // Line baselines are in PDF user space (y up); spans are from the top of the page.
      const tops = lines.map((l) => text.height - l.y)
      const lo = Math.min(...tops) - 0.5 * Math.max(...lines.map((l) => l.size))
      const hi = Math.max(...tops) + 0.5 * Math.max(...lines.map((l) => l.size))
      const spans = text.spans.filter((sp) => Math.abs(sp.angle) < 1 && sp.y >= lo && sp.y <= hi)
      const grid = gridFromSpans(spans)
      const filled = grid.rows.filter((r) => r.filter((c) => c).length >= 2).length
      if (grid.widths.length >= 2 && filled >= 2 && grid.rows.length === lines.length) {
        out.push({ from: i, to: j, grid, size: lines.reduce((m, l) => m + l.size, 0) / lines.length })
      }
    }
    i = j + 1
  }
  return out
}

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

export async function pdfToDocx(doc: DocLike, pages: number[], o: WordOptions & { OPS: Ops; crop: Cropper; signal?: AbortSignal; onProgress?: (f: number) => void }): Promise<{ bytes: Uint8Array; images: number; tables: number; text: boolean }> {
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
  let tableCount = 0
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
    const blocks = buildBlocks(text.lines, body)
    const tables = o.tables === false ? [] : findTables(blocks, text)
    const topOf = (b: Block) => text.height - Math.max(...b.lines.map((l) => l.y + l.size))
    for (let bi = 0; bi < blocks.length; bi++) {
      const t = tables.find((x) => x.from === bi)
      if (t) {
        const { rows, widths, rtl } = t.grid
        items.push({ top: topOf(blocks[bi]), part: async () => ({ type: 'table', rows, widths, rtl, size: t.size }) })
        tableCount++
        bi = t.to
        continue
      }
      const b = blocks[bi]
      items.push({ top: topOf(b), part: async () => ({ type: 'p', kind: b.kind, text: b.text, size: b.size, rtl: b.rtl, align: align(b, text.width) }) })
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
  return { bytes, images: imageCount, tables: tableCount, text: hasText }
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

/** A box in PDF points from the page's top-left corner. */
export interface Box { x: number; y: number; w: number; h: number }

/**
 * Renders a page twice at `scale` (as drawn, and without its text) and returns the text-free picture
 * plus, for each box, the colour of the text drawn there, or null when no visible text was drawn in it
 * (an OCR text layer, invisible text): such boxes get no text box, so nothing appears twice.
 */
export type SlideRenderer = (pageNumber: number, scale: number, boxes: Box[]) => Promise<{ bytes: Uint8Array; ext: 'png' | 'jpeg'; colors: (string | null)[] }>

/**
 * The colour of the text in one box: compare the page as drawn with the page drawn without text, and
 * average the pixels that changed most (glyph cores rather than anti-aliased edges). Null if fewer than
 * a handful of pixels changed.
 */
export function textColor(full: Uint8ClampedArray, bare: Uint8ClampedArray, width: number, height: number, box: Box, scale: number): string | null {
  const x0 = Math.max(0, Math.floor(box.x * scale))
  const y0 = Math.max(0, Math.floor(box.y * scale))
  const x1 = Math.min(width, Math.ceil((box.x + box.w) * scale))
  const y1 = Math.min(height, Math.ceil((box.y + box.h) * scale))
  let max = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * width + x) * 4
    const d = Math.abs(full[i] - bare[i]) + Math.abs(full[i + 1] - bare[i + 1]) + Math.abs(full[i + 2] - bare[i + 2])
    if (d > max) max = d
  }
  if (max < 48) return null
  let r = 0, g = 0, b = 0, n = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * width + x) * 4
    const d = Math.abs(full[i] - bare[i]) + Math.abs(full[i + 1] - bare[i + 1]) + Math.abs(full[i + 2] - bare[i + 2])
    if (d >= max * 0.7) { r += full[i]; g += full[i + 1]; b += full[i + 2]; n++ }
  }
  if (n < 4) return null
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0').toUpperCase()
  return hex(r) + hex(g) + hex(b)
}

/** Text boxes for one page: one per paragraph, one per cell for rows with column gaps. */
export function slideTexts(text: PageText, body: number): Omit<SlideText, 'color'>[] {
  const out: Omit<SlideText, 'color'>[] = []
  const H = text.height
  for (const b of buildBlocks(text.lines, body)) {
    const ls = b.lines
    if (ls.length === 1 && ls[0].text.includes('\t')) {
      // Cells keep their own positions, so columns stay where they were.
      const l = ls[0]
      const base = H - l.y
      const spans = text.spans.filter((sp) => Math.abs(sp.angle) < 1 && Math.abs(sp.y - base) <= l.size * 0.5)
      for (const row of rowsFromSpans(spans)) {
        for (const c of row.cells) {
          out.push({ x: c.x0, y: base - l.size * 0.96, w: c.x1 - c.x0, h: l.size * 1.2, lines: [c.text], size: l.size, lineGap: l.size * 1.2, rtl: isRtlText(c.text), align: 'start' })
        }
      }
      continue
    }
    const gaps = ls.slice(1).map((l, i) => ls[i].y - l.y)
    // Evenly spaced lines stay one text box (one paragraph per line); uneven ones get a box each, since a
    // text box has one line spacing.
    const even = gaps.length > 0 && gaps.every((g) => g > 0) && Math.max(...gaps) / Math.min(...gaps) < 1.15
    const groups = even || ls.length === 1 ? [ls] : ls.map((l) => [l])
    for (const g of groups) {
      const size = g.reduce((m, l) => m + l.size, 0) / g.length
      const lineGap = g.length > 1 ? (g[0].y - g[g.length - 1].y) / (g.length - 1) : size * 1.2
      // Office puts the first baseline about 0.8 of the line spacing below the top of the box.
      const top = H - g[0].y - lineGap * 0.8
      const bottom = H - g[g.length - 1].y + lineGap * 0.2
      const x0 = Math.min(...g.map((l) => l.x0))
      const x1 = Math.max(...g.map((l) => l.x1))
      out.push({ x: x0, y: top, w: x1 - x0, h: bottom - top, lines: g.map((l) => l.text.replace(/\t+/g, ' ')), size, lineGap, rtl: b.rtl, align: align(b, text.width) })
    }
  }
  return out
}

export interface PptxOptions { title: string; dpi: number; editable: boolean; crop: Cropper; render: SlideRenderer; signal?: AbortSignal; onProgress?: (f: number) => void }

export async function pdfToPptx(doc: DocLike, pages: number[], o: PptxOptions): Promise<{ bytes: Uint8Array; textBoxes: number }> {
  const slides: Slide[] = []
  let textBoxes = 0
  for (let k = 0; k < pages.length; k++) {
    if (o.signal?.aborted) throw new CancelledError()
    const page = await doc.getPage(pages[k])
    const vp = page.getViewport({ scale: 1 })
    const rotated = ((page.rotate ?? 0) % 360) !== 0
    page.cleanup()
    // Rotated pages keep the picture-only slide: their text positions are in another frame.
    const text = o.editable && !rotated ? await readPageText(doc, pages[k]) : null
    const boxes = text ? slideTexts(text, bodySize(text.lines)) : []
    if (boxes.length) {
      const r = await o.render(pages[k], o.dpi / 72, boxes)
      const texts = boxes.flatMap((b, i) => (r.colors[i] ? [{ ...b, color: r.colors[i]! }] : []))
      textBoxes += texts.length
      // Nothing visible to edit (a scan with an OCR layer): the plain page picture is the slide.
      if (texts.length) slides.push({ image: r.bytes, ext: r.ext, width: vp.width, height: vp.height, texts })
      else { const img = await o.crop(pages[k], null, o.dpi / 72); slides.push({ image: img.bytes, ext: img.ext, width: vp.width, height: vp.height }) }
    } else {
      const img = await o.crop(pages[k], null, o.dpi / 72)
      slides.push({ image: img.bytes, ext: img.ext, width: vp.width, height: vp.height })
    }
    o.onProgress?.(((k + 1) / pages.length) * 0.95)
  }
  return { bytes: await buildPptx(slides, { title: o.title }), textBoxes }
}
