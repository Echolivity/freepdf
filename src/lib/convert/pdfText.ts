/**
 * Turning a PDF's positioned text back into lines, paragraphs and headings.
 *
 * A PDF has no paragraphs: it draws fragments of text at coordinates. PDF.js gives us those fragments
 * (in logical order for right-to-left scripts). Here we group them into lines by baseline, order each
 * line left-to-right (or right-to-left when the line is mostly Arabic/Hebrew), add spaces where there
 * are visible gaps, then group lines into blocks by vertical spacing and font size.
 */

export interface TextItem {
  str: string
  /** Baseline origin and size in PDF user space (y grows upwards). */
  x: number
  y: number
  width: number
  size: number
  /** False for rotated or skewed text. */
  upright: boolean
}

export interface Line {
  text: string
  y: number
  x0: number
  x1: number
  size: number
  rtl: boolean
}

export type BlockKind = 'h1' | 'h2' | 'h3' | 'p'

export interface Block {
  kind: BlockKind
  lines: Line[]
  /** The block's text with lines joined into a paragraph (hyphenated line breaks undone). */
  text: string
  size: number
  rtl: boolean
}

// Letters only: Arabic-Indic digits (U+0660–0669, U+06F0–06F9) are numbers, which run left to right.
const RTL_CHAR = /[\u0590-\u065f\u066a-\u06ef\u06fa-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/g
const RTL_ONE = /[\u0590-\u065f\u066a-\u06ef\u06fa-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/
const PRESENTATION = /[\ufb50-\ufdff\ufe70-\ufeff]/

/**
 * Arabic Presentation Forms-B lists each letter's shapes in order: isolated, final, then (for letters
 * that join on both sides) initial and medial. Grouping the block by base letter tells us each shape.
 */
const FORM = (() => {
  const form = new Map<string, 'iso' | 'fin' | 'ini' | 'med'>()
  const order = ['iso', 'fin', 'ini', 'med'] as const
  let base = ''
  let i = 0
  for (let c = 0xfe80; c <= 0xfefc; c++) {
    const ch = String.fromCharCode(c)
    const b = ch.normalize('NFKC')
    if (b !== base) { base = b; i = 0 }
    form.set(ch, order[Math.min(i++, 3)])
  }
  return form
})()

/**
 * Some PDFs (notably those printed by browsers) map Arabic glyphs to presentation forms, and may
 * store a run in visual (reversed) order. A word in reading order starts with an isolated or initial
 * shape and ends with an isolated or final one; when the shapes say the opposite, the run is reversed
 * back. Finally presentation forms are replaced by the ordinary letters, so the text can be searched.
 */
export function fixArabic(s: string): string {
  if (!PRESENTATION.test(s)) return s
  // A run: Arabic words separated by spaces, Arabic punctuation or digits — never Latin text or dashes.
  const fixed = s.replace(/[\ufb50-\ufdff\ufe70-\ufeff\u0600-\u065f\u066a-\u06ef][\ufb50-\ufdff\ufe70-\ufeff\u0600-\u06ff\s،؛؟0-9]*[\ufb50-\ufdff\ufe70-\ufeff\u0600-\u065f\u066a-\u06ef]/g, (run) => {
    const words = run.match(/[\ufe70-\ufeff]{2,}/g) ?? []
    let reversed = 0
    let forward = 0
    for (const w of words) {
      const first = FORM.get(w[0])
      const last = FORM.get(w[w.length - 1])
      if (first === 'fin' || first === 'med' || last === 'ini' || last === 'med') reversed++
      else if (first === 'ini' || last === 'fin') forward++
    }
    if (reversed <= forward) return run
    // Reverse the run, keeping numbers (which are left-to-right) the right way round.
    return [...run].reverse().join('').replace(/[0-9٠-٩]+/g, (n) => [...n].reverse().join(''))
  })
  return fixed.replace(/[\ufb50-\ufdff\ufe70-\ufeff]/g, (c) => c.normalize('NFKC'))
}
const LTR_CHAR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/g

export function isRtlText(s: string): boolean {
  const r = s.match(RTL_CHAR)?.length ?? 0
  const l = s.match(LTR_CHAR)?.length ?? 0
  return r > l
}

/** Items from a PDF.js `getTextContent()` result, in user space. Empty fragments are dropped. */
export function itemsFromContent(content: { items: unknown[] }): TextItem[] {
  const out: TextItem[] = []
  for (const raw of content.items) {
    const it = raw as { str?: string; transform?: number[]; width?: number; height?: number }
    if (typeof it.str !== 'string' || !it.transform || !it.str.length) continue
    const [a, b, c, d, e, f] = it.transform
    const size = Math.hypot(c, d) || it.height || 0
    if (!size || !Number.isFinite(e) || !Number.isFinite(f)) continue
    out.push({ str: fixArabic(it.str), x: e, y: f, width: it.width ?? 0, size, upright: Math.abs(b) < 1e-3 && Math.abs(c) < 1e-3 && a > 0 && d > 0 })
  }
  return out
}

/** Group fragments into lines (top of the page first). */
export function buildLines(items: TextItem[]): Line[] {
  const upright = items.filter((i) => i.upright && i.str.trim())
  // Rotated text (a vertical label, a stamp) is kept, each fragment on its own line, after the rest.
  const other = items.filter((i) => !i.upright && i.str.trim())
  upright.sort((a, b) => b.y - a.y || a.x - b.x)

  const groups: TextItem[][] = []
  for (const it of upright) {
    const g = groups[groups.length - 1]
    if (g) {
      const ref = g[0]
      const tol = Math.min(ref.size, it.size) * 0.5
      if (Math.abs(ref.y - it.y) <= tol) { g.push(it); continue }
    }
    groups.push([it])
  }

  // Mixed lines follow the page: on a mostly Arabic page, a line with any Arabic is right-to-left
  // even if it has more Latin letters ("Contract reference: FP-2026-001 — مرجع العقد.").
  const pageRtl = isRtlText(upright.map((i) => i.str).join(''))
  const lines = groups.map((g) => joinLine(g, pageRtl))
  for (const it of other) lines.push({ text: it.str.trim(), y: it.y, x0: it.x, x1: it.x + it.width, size: it.size, rtl: isRtlText(it.str) })
  return lines
}

function joinLine(items: TextItem[], pageRtl = false): Line {
  const all = items.map((i) => i.str).join('')
  const rtl = isRtlText(all) || (pageRtl && RTL_ONE.test(all))
  // Visual order, then reading order: right-to-left lines are read from their right edge…
  let sorted = [...items].sort((a, b) => (rtl ? b.x + b.width - (a.x + a.width) : a.x - b.x))
  // …except that numbers and Latin words inside them still read left to right (a small part of the
  // Unicode bidi algorithm): touching number fragments ("1448" "/" "05") form one number; Latin words
  // join across spaces; separate numbers (table cells) and edge punctuation keep the line's direction.
  sorted = rtl ? ltrRunsInRtl(sorted) : rtlRunsInLtr(sorted)
  let text = ''
  let prev: TextItem | null = null
  for (const it of sorted) {
    if (prev) {
      // The space between the two boxes, whichever way round they are.
      const gap = Math.max(prev.x, it.x) - Math.min(prev.x + prev.width, it.x + it.width)
      const size = Math.max(prev.size, it.size)
      const spaced = /\s$/.test(text) || /^\s/.test(it.str)
      // A wide gap is a column or table break; a narrow one is a word space PDF didn't encode.
      if (gap > size * 2.5) text = text.replace(/\s+$/, '') + '\t'
      else if (!spaced && gap > size * 0.15) text += ' '
    }
    text += it.str
    prev = it
  }
  const size = items.reduce((m, i) => m + i.size * i.str.length, 0) / Math.max(1, items.reduce((m, i) => m + i.str.length, 0))
  return {
    text: text.replace(/[  ]+/g, ' ').trim(),
    y: items[0].y,
    x0: Math.min(...items.map((i) => i.x)),
    x1: Math.max(...items.map((i) => i.x + i.width)),
    size,
    rtl,
  }
}

const LATIN = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/
const DIGIT = /[0-9٠-٩۰-۹]/

function ltrRunsInRtl(sorted: TextItem[]): TextItem[] {
  const kind = (it: TextItem) => (RTL_ONE.test(it.str) ? 'R' : LATIN.test(it.str) ? 'L' : DIGIT.test(it.str) ? 'D' : 'N')
  const gap = (a: TextItem, b: TextItem) => Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width)
  const touching = (a: TextItem, b: TextItem) => gap(a, b) <= Math.max(a.size, b.size) * 0.15
  const out: TextItem[] = []
  let i = 0
  while (i < sorted.length) {
    if (kind(sorted[i]) === 'R') { out.push(sorted[i++]); continue }
    // Collect a candidate run of non-RTL fragments that belong together.
    let j = i + 1
    while (j < sorted.length && kind(sorted[j]) !== 'R') {
      const a = sorted[j - 1]
      const b = sorted[j]
      const words = kind(a) === 'L' && kind(b) === 'L' && gap(a, b) < Math.max(a.size, b.size) * 2.5
      if (!words && !touching(a, b)) break
      j++
    }
    let run = sorted.slice(i, j)
    // Neutral punctuation at either end takes the line's (right-to-left) direction.
    let head = 0
    let tail = run.length
    while (head < tail && kind(run[head]) === 'N') head++
    while (tail > head && kind(run[tail - 1]) === 'N') tail--
    run = [...run.slice(0, head), ...run.slice(head, tail).reverse(), ...run.slice(tail)]
    out.push(...run)
    i = j
  }
  return out
}

/** Arabic fragments inside a left-to-right line are drawn right to left: put them in reading order. */
function rtlRunsInLtr(sorted: TextItem[]): TextItem[] {
  const isR = (it: TextItem) => RTL_ONE.test(it.str)
  const isN = (it: TextItem) => !isR(it) && !LATIN.test(it.str) && !DIGIT.test(it.str)
  const out: TextItem[] = []
  let i = 0
  while (i < sorted.length) {
    if (!isR(sorted[i])) { out.push(sorted[i++]); continue }
    // An Arabic run: Arabic fragments, and spaces or punctuation that sit between two of them.
    let j = i + 1
    while (j < sorted.length && (isR(sorted[j]) || (isN(sorted[j]) && sorted.slice(j + 1).find((x) => !isN(x)) && isR(sorted.slice(j + 1).find((x) => !isN(x))!)))) j++
    out.push(...sorted.slice(i, j).reverse())
    i = j
  }
  return out
}

/** The most common text size, weighted by characters: the body size headings are compared with. */
export function bodySize(lines: Line[]): number {
  const counts = new Map<number, number>()
  for (const l of lines) {
    const k = Math.round(l.size * 2) / 2
    counts.set(k, (counts.get(k) ?? 0) + l.text.length)
  }
  let best = 0
  let size = 12
  for (const [k, n] of counts) if (n > best) { best = n; size = k }
  return size
}

/** Join a block's lines into running text, undoing end-of-line hyphenation ("infor-" + "mation"). */
export function joinParagraph(lines: string[]): string {
  let out = ''
  for (const l of lines) {
    if (!out) { out = l; continue }
    if (/\p{L}-$/u.test(out) && /^\p{Ll}/u.test(l)) out = out.slice(0, -1) + l
    else out += ' ' + l
  }
  return out
}

/** Group lines into paragraphs and headings by vertical spacing and size. */
export function buildBlocks(lines: Line[], body: number): Block[] {
  const blocks: Block[] = []
  // The page's usual line spacing (median gap between neighbouring same-size lines): a paragraph
  // break is a gap clearly larger than that, whatever line height the document uses.
  const gaps: number[] = []
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i - 1].y - lines[i].y
    if (g > 0 && Math.abs(lines[i - 1].size - lines[i].size) / lines[i].size < 0.12) gaps.push(g / lines[i].size)
  }
  gaps.sort((x, y) => x - y)
  // With only two gaps to compare, the smaller one is the line wrap.
  const usual = gaps.length >= 3 ? gaps[Math.floor(gaps.length / 2)] : gaps.length === 2 ? gaps[0] : 0
  const breakAt = usual ? Math.max(1.25, Math.min(usual * 1.3, 2.4)) : 1.7
  let cur: Line[] = []
  const flush = () => {
    if (!cur.length) return
    const size = cur.reduce((m, l) => m + l.size, 0) / cur.length
    const text = joinParagraph(cur.map((l) => l.text.replace(/\t/g, ' ')))
    const ratio = size / body
    const short = text.length <= 200
    const kind: BlockKind = short && ratio >= 1.6 ? 'h1' : short && ratio >= 1.3 ? 'h2' : short && ratio >= 1.12 ? 'h3' : 'p'
    blocks.push({ kind, lines: cur, text, size, rtl: cur.filter((l) => l.rtl).length * 2 > cur.length })
    cur = []
  }
  for (const l of lines) {
    const prev = cur[cur.length - 1]
    if (prev) {
      const gap = prev.y - l.y
      const size = Math.max(prev.size, l.size)
      const sizeChange = Math.abs(prev.size - l.size) / Math.min(prev.size, l.size) > 0.12
      // Baselines further apart than usual (or going back up the page) start a new block.
      if (gap > size * breakAt || gap < 0 || sizeChange) flush()
    }
    cur.push(l)
  }
  flush()
  return blocks
}

/** One page as plain text: either the PDF's own lines, or reflowed paragraphs separated by blank lines. */
export function pageText(lines: Line[], mode: 'lines' | 'paragraphs', body: number): string {
  const blocks = buildBlocks(lines, body)
  // Lines mode keeps the PDF's line breaks; a blank line marks where the spacing shows a new block.
  if (mode === 'lines') return blocks.map((b) => b.lines.map((l) => l.text).join('\n')).join('\n\n')
  return blocks.map((b) => b.text).join('\n\n')
}
