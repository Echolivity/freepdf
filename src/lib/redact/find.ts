/**
 * Redact PDF (main-thread side): where text sits on a page, finding what to redact (typed text and
 * patterns such as emails, phone numbers, IBANs, card numbers and ID numbers), and which words stay
 * searchable after redaction.
 *
 * PDF.js gives text as runs ("spans") with a position, direction and width, not per-character boxes,
 * so a character's position inside a run is estimated in proportion to its index. Match boxes are
 * padded to absorb that estimate, and a word is only kept in the text layer when it is clear of every
 * box (with padding) and contains none of the searched text, so a redacted word can't survive there.
 */
import type { LayerWord } from '../ocr/textLayer'

/** A rectangle on the displayed page, in points from its top-left corner. */
export interface Box {
  page: number
  x: number
  y: number
  w: number
  h: number
  /** Made by a search (its text is also excluded by content), rather than drawn by hand. */
  found?: boolean
}

/** A text run on the displayed page (points, top-left origin, y down). */
export interface Span {
  str: string
  /** Baseline origin of the run's visual left end. */
  x: number
  y: number
  /** Unit baseline direction, in displayed (y-down) coordinates. */
  dx: number
  dy: number
  size: number
  width: number
  rtl: boolean
}

export interface PageSpans { page: number; width: number; height: number; spans: Span[] }

export type PatternId = 'email' | 'phone' | 'iban' | 'card' | 'id'
export const PATTERNS: PatternId[] = ['email', 'phone', 'iban', 'card', 'id']

// ---------------------------------------------------------------- reading

interface TextItemLike { str?: string; transform?: number[]; width?: number; dir?: string }
interface PageLike {
  getViewport(o: { scale: number }): { width: number; height: number; transform: number[] }
  getTextContent(): Promise<{ items: unknown[] }>
  cleanup(): void
}

function mul(m1: number[], m2: number[]): number[] {
  const [a1, b1, c1, d1, e1, f1] = m1
  const [a2, b2, c2, d2, e2, f2] = m2
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1]
}

// Right-to-left letters (Hebrew, Arabic); Arabic-Indic digits are left out: digits run left to right.
const RTL_CHAR = /[\u0590-\u065F\u066A-\u06EF\u06FA-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/

/** Read a page's text runs, positioned on the displayed (rotated, cropped) page. */
export async function readSpans(doc: { getPage(n: number): Promise<PageLike> }, index: number): Promise<PageSpans> {
  const page = await doc.getPage(index + 1)
  try {
    const vp = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const spans: Span[] = []
    for (const raw of content.items) {
      const it = raw as TextItemLike
      if (!it.str || !it.str.trim() || !it.transform) continue
      const m = mul(vp.transform, it.transform)
      const len = Math.hypot(m[0], m[1])
      const size = Math.hypot(m[2], m[3])
      const width = Math.abs(it.width ?? 0)
      if (!len || !size || !width || !Number.isFinite(m[4]) || !Number.isFinite(m[5])) continue
      spans.push({ str: it.str, x: m[4], y: m[5], dx: m[0] / len, dy: m[1] / len, size, width, rtl: it.dir !== 'ltr' && RTL_CHAR.test(it.str) })
    }
    return { page: index, width: vp.width, height: vp.height, spans }
  } finally {
    page.cleanup()
  }
}

// ---------------------------------------------------------------- geometry

/** Typical relative advance width of a character (Helvetica-like), to place characters inside a run. */
function advance(c: string): number {
  if (/[iljI.,:;'|!`]/.test(c)) return 0.26
  if (c === ' ') return 0.28
  if (/[ftr()[\]{}"-]/.test(c)) return 0.36
  if (/[mwMW@%]/.test(c)) return 0.86
  if (/[A-Z&#]/.test(c)) return 0.68
  if (/[0-9$]/.test(c)) return 0.56
  return 0.52
}

const cumulative = new Map<string, number[]>()
function fractions(str: string): number[] {
  let f = cumulative.get(str)
  if (!f) {
    f = [0]
    for (const c of str) f.push(f[f.length - 1] + advance(c))
    const total = f[f.length - 1] || 1
    f = f.map((v) => v / total)
    if (cumulative.size > 5000) cumulative.clear()
    cumulative.set(str, f)
  }
  return f
}

/** Visual extent along the baseline (fractions 0..1 from the left end) of characters [s, e). */
function along(span: Span, s: number, e: number): [number, number] {
  const f = fractions(span.str)
  // Surrogate pairs make [...str] shorter than str.length; fall back to proportional by index.
  const at = (i: number) => (f.length === span.str.length + 1 ? f[i] : i / (span.str.length || 1))
  return span.rtl ? [1 - at(e), 1 - at(s)] : [at(s), at(e)]
}

/**
 * Axis-aligned box around characters [s, e) of a span, padded along the baseline by `padX` and across
 * it by `padY`, both times the type size.
 */
export function charBox(span: Span, s: number, e: number, page: number, padX = 0.1, padY = padX): Box {
  const [f0, f1] = along(span, s, e)
  const p = span.size * padY
  const a0 = f0 * span.width - span.size * padX
  const a1 = f1 * span.width + span.size * padX
  // "Up" is perpendicular to the baseline; in y-down coordinates that is (dy, -dx).
  const ux = span.dy
  const uy = -span.dx
  const up = span.size * 0.95 + p
  const down = span.size * 0.3 + p
  const xs: number[] = []
  const ys: number[] = []
  for (const a of [a0, a1]) for (const u of [up, -down]) {
    xs.push(span.x + span.dx * a + ux * u)
    ys.push(span.y + span.dy * a + uy * u)
  }
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { page, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

export const overlaps = (a: Box, b: Box) => a.page === b.page && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Merge boxes that overlap or touch on the same line into one, so a match is one tidy box. */
export function mergeBoxes(boxes: Box[]): Box[] {
  const out: Box[] = []
  for (const b of boxes) {
    const hit = out.find((o) => o.page === b.page && overlaps({ ...o, x: o.x - 1, w: o.w + 2 }, b) && Math.abs(o.y - b.y) < Math.min(o.h, b.h) * 0.5)
    if (hit) {
      const x = Math.min(hit.x, b.x), y = Math.min(hit.y, b.y)
      hit.w = Math.max(hit.x + hit.w, b.x + b.w) - x
      hit.h = Math.max(hit.y + hit.h, b.y + b.h) - y
      hit.x = x
      hit.y = y
    } else out.push({ ...b })
  }
  return out
}

// ---------------------------------------------------------------- matching

/** Arabic-Indic and Persian digits → ASCII (same length, so indices still line up). */
export function normaliseDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
}

function luhn(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2) { d *= 2; if (d > 9) d -= 9 }
    sum += d
  }
  return sum % 10 === 0
}

function ibanValid(raw: string): boolean {
  const s = raw.replace(/ /g, '')
  if (s.length < 15 || s.length > 34) return false
  const moved = s.slice(4) + s.slice(0, 4)
  let rem = 0
  for (const c of moved) {
    const v = /\d/.test(c) ? c : String(c.charCodeAt(0) - 55)
    for (const d of v) rem = (rem * 10 + Number(d)) % 97
  }
  return rem === 1
}

const DATE_LIKE = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})$/

const RULES: Record<PatternId, { re: RegExp; ok?: (m: string) => boolean }> = {
  email: { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  iban: { re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, ok: ibanValid },
  card: { re: /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g, ok: (m) => luhn(m.replace(/\D/g, '')) },
  // Saudi national ID and Iqama numbers: 10 digits starting with 1 or 2.
  id: { re: /(?<!\d)[12]\d{9}(?!\d)/g },
  phone: {
    re: /(?<![\w+])(?:\+|00)?\(?\d{1,4}\)?(?:[ .-]?\(?\d{2,4}\)?){2,5}(?![\w])/g,
    ok: (m) => {
      const digits = m.replace(/\D/g, '').length
      return digits >= 8 && digits <= 15 && !DATE_LIKE.test(m) && !/^\d+\.\d+$/.test(m)
    },
  },
}

/** Character ranges [start, end) in `text` that match the given patterns or search terms. */
export function findRanges(text: string, patterns: PatternId[], terms: string[]): [number, number][] {
  const norm = normaliseDigits(text)
  const out: [number, number][] = []
  for (const id of patterns) {
    const { re, ok } = RULES[id]
    re.lastIndex = 0
    for (const m of norm.matchAll(re)) if (!ok || ok(m[0])) out.push([m.index!, m.index! + m[0].length])
  }
  const lower = norm.toLocaleLowerCase()
  for (const raw of terms) {
    const t = normaliseDigits(raw.trim()).toLocaleLowerCase()
    if (!t) continue
    for (let i = lower.indexOf(t); i >= 0; i = lower.indexOf(t, i + t.length)) out.push([i, i + t.length])
  }
  return out.sort((a, b) => a[0] - b[0])
}

/**
 * Find matches on a page and return boxes covering them. Runs on the same line are joined first, so a
 * phone number or IBAN split into several runs is still found.
 */
export function findOnPage(p: PageSpans, patterns: PatternId[], terms: string[]): { boxes: Box[]; matches: number } {
  // Join runs into lines: consecutive runs with nearly the same baseline and direction.
  const lines: { text: string; parts: { span: Span; at: number }[] }[] = []
  let cur: (typeof lines)[number] | null = null
  let prev: Span | null = null
  for (const s of p.spans) {
    const sameLine = prev && Math.abs(prev.dx - s.dx) < 0.01 && Math.abs(prev.dy - s.dy) < 0.01 &&
      Math.abs((s.y - prev.y) * prev.dx - (s.x - prev.x) * prev.dy) < Math.min(prev.size, s.size) * 0.4
    if (!cur || !sameLine) { cur = { text: '', parts: [] }; lines.push(cur) }
    else if (!/\s$/.test(cur.text) && !/^\s/.test(s.str)) cur.text += ' '
    cur.parts.push({ span: s, at: cur.text.length })
    cur.text += s.str
    prev = s
  }
  const boxes: Box[] = []
  let matches = 0
  for (const line of lines) {
    const ranges = findRanges(line.text, patterns, terms)
    matches += ranges.length
    for (const [a, b] of ranges) {
      for (const { span, at } of line.parts) {
        const s = Math.max(a, at) - at
        const e = Math.min(b, at + span.str.length) - at
        if (e > s) boxes.push({ ...charBox(span, s, e, p.page, 0.1, 0.2), found: true })
      }
    }
  }
  return { boxes: mergeBoxes(boxes), matches }
}

// ---------------------------------------------------------------- what stays searchable

/**
 * Words of a page that stay in the invisible text layer after redaction: those clear of every box
 * (with padding) that contain none of the searched text. Returned in the rebuilt page's user space.
 */
export function keptWords(p: PageSpans, boxes: Box[], patterns: PatternId[], terms: string[]): LayerWord[] {
  const mine = boxes.filter((b) => b.page === p.page)
  const out: LayerWord[] = []
  for (const span of p.spans) {
    for (const m of span.str.matchAll(/\S+/g)) {
      const s = m.index!
      const e = s + m[0].length
      const box = charBox(span, s, e, p.page, 0.05, 0.1)
      // Boxes drawn by hand get a wider margin: a word placed slightly off by the position estimate is
      // dropped rather than kept. Searched text is also excluded by its content, just below.
      const margin = span.size * 0.3
      if (mine.some((b) => overlaps(b.found ? b : { ...b, x: b.x - margin, w: b.w + 2 * margin }, box))) continue
      if (findRanges(m[0], patterns, terms).length) continue
      const [f0, f1] = along(span, s, e)
      // Displayed (y down) → rebuilt page user space (y up): flip y, and the baseline's y component.
      const ox = span.x + span.dx * f0 * span.width
      const oy = span.y + span.dy * f0 * span.width
      out.push({ text: m[0], m: [span.dx, -span.dy, span.dy, span.dx, ox, p.height - oy], size: span.size, width: (f1 - f0) * span.width })
    }
  }
  return out
}
