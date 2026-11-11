/**
 * Laid-out DOM → PDF, for Word, Excel and HTML input.
 *
 * The browser is the layout engine: the document is rendered off-screen (in a shadow root, so its
 * styles can't leak into the app), then we read back where every word, background, border and image
 * ended up and draw exactly that into PDF pages. Text stays real text. Each word is drawn at its
 * measured position and squeezed or stretched (PDF `Tz`) to its measured width, so line breaks and
 * alignment match the browser's even when the PDF font isn't the font the browser used. Pages are
 * cut between lines, never through a line or an image.
 *
 * Main thread only (needs layout). Nothing here makes a network request: the caller must have
 * removed every external reference, and the app's CSP blocks any that slipped through.
 */
import {
  PDFDocument,
  StandardFonts,
  beginText,
  clip,
  endPath,
  endText,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setCharacterSqueeze,
  setDashPattern,
  setFillingRgbColor,
  setFontAndSize,
  setLineWidth,
  setStrokingRgbColor,
  setTextMatrix,
  showText,
  stroke,
  fill,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'
import { fitsStandardFont, fontFor } from '../pdf/fonts'
import { visualRuns } from '../pdf/text'
import { CancelledError } from '../workerClient'

export interface Flow {
  /** The element whose content box is the page's content area. Must be attached and laid out. */
  root: HTMLElement
  /** Page size and margins in PDF points. */
  pageWidth: number
  pageHeight: number
  margin: { top: number; right: number; bottom: number; left: number }
  /** Extra scale from CSS px to the page (1 = actual size; < 1 to fit a wide sheet). */
  fit?: number
  /** Leave the browser's padding out of the origin (the padding *is* the margin, as for Word pages). */
  paddingIsMargin?: boolean
  /** Running headers and footers: left out of the flow and drawn on every page, in the margins. */
  header?: HTMLElement | null
  footer?: HTMLElement | null
  /** Right-to-left content narrower than the page starts at the right margin. */
  alignEnd?: boolean
}

type RGB = [number, number, number]
interface Word { text: string; x: number; y: number; w: number; h: number; size: number; bold: boolean; italic: boolean; color: RGB; face: Face; deco: { under: boolean; strike: boolean } }
interface Box { x: number; y: number; w: number; h: number; color: RGB }
interface Rule { x1: number; y1: number; x2: number; y2: number; width: number; color: RGB; dash: boolean }
interface Pic { x: number; y: number; w: number; h: number; el: HTMLImageElement | HTMLCanvasElement }
type Face = 'sans' | 'serif' | 'mono'

interface Collected { words: Word[]; boxes: Box[]; rules: Rule[]; pics: Pic[]; breaks: number[]; height: number; width: number }

export interface DomToPdfOptions {
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
  title?: string
}

const PX = 0.75 // CSS px → PDF pt

function parseRgb(css: string): { rgb: RGB; a: number } | null {
  const m = /rgba?\(([^)]+)\)/.exec(css)
  if (!m) return null
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
  if (p.length < 3 || p.slice(0, 3).some((v) => !Number.isFinite(v))) return null
  return { rgb: [p[0] / 255, p[1] / 255, p[2] / 255], a: p.length > 3 && Number.isFinite(p[3]) ? p[3] : 1 }
}

function faceOf(family: string): Face {
  const f = family.toLowerCase()
  if (/mono|courier|consolas|menlo|lucida console/.test(f)) return 'mono'
  if (/(^|[\s,"'])(serif|times|georgia|garamond|cambria|book|palatino|minion|baskerville)/.test(f) && !/sans/.test(f.split(',')[0])) return 'serif'
  return 'sans'
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

/** Read every visible word, background, border and image under `root`, relative to its content box. */
async function collect(flow: Flow, signal?: AbortSignal, only?: { el: HTMLElement; ox: number; oy: number }): Promise<Collected> {
  const root = only?.el ?? flow.root
  const rr = flow.root.getBoundingClientRect()
  const rs = getComputedStyle(flow.root)
  const ox = only ? only.ox : rr.left + (flow.paddingIsMargin ? parseFloat(rs.paddingLeft) + parseFloat(rs.borderLeftWidth) : 0)
  const oy = only ? only.oy : rr.top + (flow.paddingIsMargin ? parseFloat(rs.paddingTop) + parseFloat(rs.borderTopWidth) : 0)
  const skip = new Set<Element>(only ? [] : ([flow.header, flow.footer].filter(Boolean) as Element[]))
  const out: Collected = { words: [], boxes: [], rules: [], pics: [], breaks: [], height: 0, width: 0 }
  const range = document.createRange()
  let visited = 0

  const walk = async (el: Element) => {
    if (++visited % 400 === 0) {
      if (signal?.aborted) throw new CancelledError()
      await tick()
    }
    if (skip.has(el)) return
    const cs = getComputedStyle(el)
    if (cs.display === 'none') return
    const hidden = cs.visibility === 'hidden' || cs.visibility === 'collapse'
    const r = el.getBoundingClientRect()
    if (!hidden && el !== root) {
      out.height = Math.max(out.height, r.bottom - oy)
      out.width = Math.max(out.width, r.right - ox)
    }
    if (cs.breakBefore === 'page' || (cs as unknown as { pageBreakBefore?: string }).pageBreakBefore === 'always') out.breaks.push(r.top - oy)
    if (cs.breakAfter === 'page' || (cs as unknown as { pageBreakAfter?: string }).pageBreakAfter === 'always') out.breaks.push(r.bottom - oy)

    if (!hidden && !(flow.paddingIsMargin && el === flow.root)) {
      const bg = parseRgb(cs.backgroundColor)
      if (bg && bg.a > 0.02) {
        const rects = cs.display === 'inline' ? [...el.getClientRects()] : [r]
        for (const b of rects) if (b.width > 0 && b.height > 0) out.boxes.push({ x: b.left - ox, y: b.top - oy, w: b.width, h: b.height, color: blend(bg.rgb, bg.a) })
      }
      if (cs.display !== 'inline') {
        const side = (w: string, st: string, c: string, x1: number, y1: number, x2: number, y2: number) => {
          const width = parseFloat(w)
          const col = parseRgb(c)
          if (!(width > 0) || st === 'none' || st === 'hidden' || !col || col.a < 0.05) return
          out.rules.push({ x1: x1 - ox, y1: y1 - oy, x2: x2 - ox, y2: y2 - oy, width, color: blend(col.rgb, col.a), dash: st === 'dashed' || st === 'dotted' })
        }
        side(cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor, r.left, r.top + parseFloat(cs.borderTopWidth) / 2, r.right, r.top + parseFloat(cs.borderTopWidth) / 2)
        side(cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor, r.left, r.bottom - parseFloat(cs.borderBottomWidth) / 2, r.right, r.bottom - parseFloat(cs.borderBottomWidth) / 2)
        side(cs.borderLeftWidth, cs.borderLeftStyle, cs.borderLeftColor, r.left + parseFloat(cs.borderLeftWidth) / 2, r.top, r.left + parseFloat(cs.borderLeftWidth) / 2, r.bottom)
        side(cs.borderRightWidth, cs.borderRightStyle, cs.borderRightColor, r.right - parseFloat(cs.borderRightWidth) / 2, r.top, r.right - parseFloat(cs.borderRightWidth) / 2, r.bottom)
      }
      if ((el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0) || el instanceof HTMLCanvasElement) {
        if (r.width > 0 && r.height > 0) out.pics.push({ x: r.left - ox, y: r.top - oy, w: r.width, h: r.height, el: el as HTMLImageElement | HTMLCanvasElement })
        return
      }
    }

    for (const child of el.shadowRoot ? [...el.shadowRoot.childNodes] : [...el.childNodes]) {
      if (child.nodeType === Node.ELEMENT_NODE) await walk(child as Element)
      else if (child.nodeType === Node.TEXT_NODE && !hidden) words(child as Text, cs)
    }
  }

  const words = (node: Text, cs: CSSStyleDeclaration) => {
    const raw = node.data
    if (!raw.trim()) return
    const color = parseRgb(cs.color)
    if (color && color.a < 0.05) return
    const size = parseFloat(cs.fontSize)
    if (!(size > 0)) return
    const transform = cs.textTransform
    const style = {
      size,
      bold: Number(cs.fontWeight) >= 600 || cs.fontWeight === 'bold',
      italic: cs.fontStyle === 'italic' || cs.fontStyle.startsWith('oblique'),
      color: color ? blend(color.rgb, color.a) : ([0, 0, 0] as RGB),
      face: faceOf(cs.fontFamily),
      deco: { under: cs.textDecorationLine.includes('underline'), strike: cs.textDecorationLine.includes('line-through') },
    }
    // One run per word: measured individually, so justified and right-to-left text land exactly.
    for (const m of raw.matchAll(/\S+/g)) {
      const start = m.index!
      const end = start + m[0].length
      range.setStart(node, start)
      range.setEnd(node, end)
      const rects = [...range.getClientRects()].filter((b) => b.width > 0 && b.height > 0)
      if (!rects.length) continue
      let text = m[0]
      if (transform === 'uppercase') text = text.toUpperCase()
      else if (transform === 'lowercase') text = text.toLowerCase()
      else if (transform === 'capitalize') text = text.charAt(0).toUpperCase() + text.slice(1)
      if (rects.length === 1) {
        const b = rects[0]
        out.words.push({ text, x: b.left - ox, y: b.top - oy, w: b.width, h: b.height, ...style })
        continue
      }
      // A word broken across lines (or split by bidi): measure it character by character.
      let piece = ''
      let box: DOMRect | null = null
      const flush = () => { if (piece && box) out.words.push({ text: piece, x: box.left - ox, y: box.top - oy, w: box.width, h: box.height, ...style }); piece = ''; box = null }
      for (let i = start; i < end; ) {
        const cp = raw.codePointAt(i)!
        const len = cp > 0xffff ? 2 : 1
        range.setStart(node, i)
        range.setEnd(node, i + len)
        const b = [...range.getClientRects()].find((x) => x.width > 0)
        if (b) {
          if (box && Math.abs(b.top - box.top) < 1) {
            const left = Math.min(box.left, b.left)
            box = new DOMRect(left, box.top, Math.max(box.right, b.right) - left, Math.max(box.height, b.height))
          } else {
            flush()
            box = b
          }
          piece += raw.slice(i, i + len)
        }
        i += len
      }
      flush()
    }
  }

  await walk(root)
  return out
}

function blend(c: RGB, a: number): RGB {
  // Transparent colours are drawn over white paper.
  return a >= 1 ? c : [c[0] * a + (1 - a), c[1] * a + (1 - a), c[2] * a + (1 - a)]
}

/** Page start offsets (CSS px from the flow top): cut between lines, at forced breaks, never through a word or image. */
export function paginate(units: { top: number; bottom: number }[], forced: number[], pageHeight: number, total: number): number[] {
  const starts = [0]
  const breaks = [...new Set(forced.map((b) => Math.round(b * 10) / 10))].filter((b) => b > 1).sort((a, b) => a - b)
  const sorted = [...units].sort((a, b) => a.top - b.top)
  let top = 0
  let bi = 0
  for (const u of sorted) {
    while (bi < breaks.length && breaks[bi] <= u.top + 0.5) {
      if (breaks[bi] > top + 1) { top = breaks[bi]; starts.push(top) }
      bi++
    }
    if (u.bottom - top <= pageHeight + 0.5) continue
    if (u.top > top + 0.5) { top = u.top; starts.push(top) }
    // Taller than a page (a big image): it is cut; continue below it.
    while (u.bottom - top > pageHeight + 0.5) { top += pageHeight; starts.push(top) }
  }
  while (top + pageHeight < total - 0.5) {
    top += pageHeight
    starts.push(top)
  }
  return starts
}

interface Fonts { get(face: Face, bold: boolean, italic: boolean, text: string): Promise<{ font: PDFFont; skew: number }> }

function fontSet(doc: PDFDocument): Fonts {
  const std: Record<Face, StandardFonts[]> = {
    sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
    serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
    mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
  }
  const cache = new Map<string, PDFFont>()
  return {
    async get(face, bold, italic, text) {
      if (!fitsStandardFont(text)) {
        // Arabic and anything else outside WinAnsi: the embedded font (no italic: slant it).
        return { font: await fontFor(doc, 'plex', bold, [text]), skew: italic ? 0.2 : 0 }
      }
      const name = std[face][(bold ? 1 : 0) + (italic ? 2 : 0)]
      let f = cache.get(name)
      if (!f) { f = await doc.embedFont(name); cache.set(name, f) }
      return { font: f, skew: 0 }
    },
  }
}

/** Draw one word at its measured box: baseline from the box, width squeezed to the measured width. */
function drawWord(page: PDFPage, font: PDFFont, skew: number, w: Word, x: number, baseline: number, k: number) {
  const size = w.size * k
  const runs = visualRuns(w.text)
  const natural = runs.reduce((s, r) => s + font.widthOfTextAtSize(r.text, size), 0)
  if (!(natural > 0)) return
  const scale = Math.min(2, Math.max(0.5, (w.w * k) / natural))
  const key = page.node.newFontDictionary(font.name, font.ref)
  const ops = [pushGraphicsState(), beginText(), setFontAndSize(key, size), setCharacterSqueeze(scale * 100), setFillingRgbColor(...w.color)]
  let off = 0
  for (const r of runs) {
    if (!r.text) continue
    ops.push(setTextMatrix(1, 0, skew, 1, x + off, baseline), showText(font.encodeText(r.text)))
    off += font.widthOfTextAtSize(r.text, size) * scale
  }
  ops.push(endText(), popGraphicsState())
  page.pushOperators(...ops)
}

async function drawWordWithDeco(page: PDFPage, fonts: Fonts, w: Word, x: number, baseline: number, k: number) {
  const { font, skew } = await fonts.get(w.face, w.bold, w.italic, w.text)
  drawWord(page, font, skew, w, x, baseline, k)
  if (w.deco.under || w.deco.strike) {
    const yy = w.deco.under ? baseline - w.size * k * 0.12 : baseline + w.size * k * 0.28
    page.pushOperators(setStrokingRgbColor(...w.color), setLineWidth(Math.max(0.4, w.size * k * 0.06)), moveTo(x, yy), lineTo(x + w.w * k, yy), stroke())
  }
}

async function imageBytes(el: HTMLImageElement | HTMLCanvasElement, w: number, h: number): Promise<{ bytes: Uint8Array; png: boolean } | null> {
  // Re-encode through a canvas (blob: URLs can't be fetched under the CSP). Capped at 3000 px a side.
  const nw = el instanceof HTMLImageElement ? el.naturalWidth : el.width
  const nh = el instanceof HTMLImageElement ? el.naturalHeight : el.height
  // Keep up to 3 image pixels per CSS px shown (sharp when printed), never more than the original.
  const s = Math.min(1, 3000 / Math.max(nw, nh), Math.max(64, Math.max(w, h) * 3) / Math.max(nw, nh))
  const cw = Math.max(1, Math.round(nw * s))
  const ch = Math.max(1, Math.round(nh * s))
  const c = document.createElement('canvas')
  c.width = cw
  c.height = ch
  const ctx = c.getContext('2d')
  if (!ctx) return null
  try {
    ctx.drawImage(el, 0, 0, cw, ch)
    const data = ctx.getImageData(0, 0, cw, ch).data
    let alpha = false
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) { alpha = true; break }
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, alpha ? 'image/png' : 'image/jpeg', 0.9))
    if (!blob) return null
    return { bytes: new Uint8Array(await blob.arrayBuffer()), png: alpha }
  } catch {
    return null // a tainted or broken image is left out rather than failing the document
  } finally {
    c.width = c.height = 0
  }
}

/** Render flows (each a run of pages with one page size) into one PDF. */
export async function flowsToPdf(flows: Flow[], o: DomToPdfOptions = {}): Promise<{ pdf: Uint8Array; pages: number; skippedImages: number }> {
  const doc = await PDFDocument.create()
  doc.setProducer('FreePDF')
  doc.setCreator('FreePDF')
  if (o.title) doc.setTitle(o.title)
  const fonts = fontSet(doc)
  const picCache = new Map<HTMLImageElement | HTMLCanvasElement | string, Awaited<ReturnType<typeof doc.embedPng>> | null>()
  let skippedImages = 0

  for (let fi = 0; fi < flows.length; fi++) {
    const flow = flows[fi]
    const c = await collect(flow, o.signal)
    const k = PX * (flow.fit ?? 1)
    const contentW = flow.pageWidth - flow.margin.left - flow.margin.right
    const contentH = flow.pageHeight - flow.margin.top - flow.margin.bottom
    const pageH = contentH / k
    const units = [...c.words.map((w) => ({ top: w.y, bottom: w.y + w.h })), ...c.pics.map((p) => ({ top: p.y, bottom: p.y + p.h }))]
    const starts = paginate(units, c.breaks, pageH, c.height)
    // Running header/footer, measured from the page box (the section), not the content area.
    const sec = flow.root.getBoundingClientRect()
    const head = flow.header ? await collect(flow, o.signal, { el: flow.header, ox: sec.left, oy: sec.top }) : null
    const foot = flow.footer ? await collect(flow, o.signal, { el: flow.footer, ox: sec.left, oy: sec.bottom }) : null

    for (let pi = 0; pi < starts.length; pi++) {
      if (o.signal?.aborted) throw new CancelledError()
      const top = starts[pi]
      const bottom = pi + 1 < starts.length ? starts[pi + 1] : top + pageH
      const page = doc.addPage([flow.pageWidth, flow.pageHeight])
      const shift = flow.alignEnd ? Math.max(0, contentW - c.width * k) : 0
      const X = (x: number) => flow.margin.left + shift + x * k
      const Y = (y: number) => flow.pageHeight - flow.margin.top - (y - top) * k
      // Everything on this page is clipped to its content area (a box crossing a page break shows on both).
      page.pushOperators(pushGraphicsState(), rectangle(flow.margin.left - 1, flow.margin.bottom - 1, contentW + 2, contentH + 2), clip(), endPath())
      const within = (y: number, h: number) => y + h > top && y < bottom

      for (const b of c.boxes) if (within(b.y, b.h)) page.pushOperators(setFillingRgbColor(...b.color), rectangle(X(b.x), Y(b.y + b.h), b.w * k, b.h * k), fill())
      for (const p of c.pics) {
        if (!within(p.y, p.h)) continue
        const srcKey = p.el instanceof HTMLImageElement ? p.el.currentSrc || p.el.src : p.el
        let img = picCache.get(srcKey)
        if (img === undefined) {
          const enc = await imageBytes(p.el, p.w, p.h)
          img = enc ? await (enc.png ? doc.embedPng(enc.bytes) : doc.embedJpg(enc.bytes)) : null
          picCache.set(srcKey, img)
          if (!img) skippedImages++
        }
        if (img) page.drawImage(img, { x: X(p.x), y: Y(p.y + p.h), width: p.w * k, height: p.h * k })
      }
      for (const r of c.rules) {
        const y1 = Math.min(r.y1, r.y2)
        if (!within(y1, Math.abs(r.y2 - r.y1) || 0.1)) continue
        page.pushOperators(
          setStrokingRgbColor(...r.color),
          setLineWidth(Math.max(0.25, r.width * k)),
          setDashPattern(r.dash ? [2 * r.width * k, 2 * r.width * k] : [], 0),
          moveTo(X(r.x1), Y(r.y1)),
          lineTo(X(r.x2), Y(r.y2)),
          stroke(),
        )
      }
      page.pushOperators(setDashPattern([], 0))
      page.pushOperators(popGraphicsState())
      // Words aren't clipped (a large heading may rise a little above the content box). Each belongs to
      // the page holding its centre, so it is drawn exactly once.
      for (const w of c.words) {
        const mid = w.y + w.h / 2
        if ((pi > 0 && mid < top) || (pi + 1 < starts.length && mid >= bottom)) continue
        await drawWordWithDeco(page, fonts, w, X(w.x), Y(w.y + w.h * 0.8), k)
      }
      // Header and footer on every page, at the same place in the margins.
      const kk = PX // headers/footers are drawn at actual size
      for (const [part, base] of [[head, (y: number) => flow.pageHeight - y * kk], [foot, (y: number) => -y * kk]] as const) {
        if (!part) continue
        for (const b of part.boxes) page.pushOperators(setFillingRgbColor(...b.color), rectangle(b.x * kk, base(b.y + b.h), b.w * kk, b.h * kk), fill())
        for (const r of part.rules) page.pushOperators(setStrokingRgbColor(...r.color), setLineWidth(Math.max(0.25, r.width * kk)), moveTo(r.x1 * kk, base(r.y1)), lineTo(r.x2 * kk, base(r.y2)), stroke())
        for (const w of part.words) await drawWordWithDeco(page, fonts, w, w.x * kk, base(w.y + w.h * 0.8), kk)
      }
      o.onProgress?.((fi + (pi + 1) / starts.length) / flows.length)
      if (pi % 5 === 4) await tick()
    }
  }
  if (!doc.getPageCount()) doc.addPage()
  const pdf = await doc.save({ useObjectStreams: true })
  return { pdf, pages: doc.getPageCount(), skippedImages }
}

/** An off-screen host with a shadow root: the document's CSS stays inside, the app's stays out. */
export function offscreenHost(widthPx: number): { host: HTMLDivElement; shadow: ShadowRoot; dispose: () => void } {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.setAttribute('inert', '')
  host.style.cssText = `position:absolute;left:-200000px;top:0;width:${widthPx}px;contain:layout style;pointer-events:none`
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })
  return { host, shadow, dispose: () => host.remove() }
}

