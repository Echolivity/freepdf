import { degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

/**
 * Drawing one line of text that may mix Arabic and Latin. pdf-lib + fontkit shape an Arabic run and lay
 * its glyphs out right-to-left, but treat a whole string as one run, so "صفحة 3 من 10" would come out
 * with its numbers reversed. We split the line into directional runs (a small subset of the Unicode
 * bidi algorithm: strong Arabic/Hebrew = RTL, strong Latin = LTR, European and Arabic-Indic digits form
 * left-to-right number runs, neutrals take the direction of their neighbours or the paragraph), put the
 * runs in visual order, and draw them one after another.
 */

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/
const DIGIT = /[0-9٠-٩۰-۹]/
const LTR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/

type Dir = 'L' | 'R'
export interface Run {
  text: string
  rtl: boolean
}

/** Paragraph direction: from the first strong character (default LTR). */
export function paragraphRtl(text: string): boolean {
  for (const ch of text) {
    if (RTL.test(ch)) return true
    if (LTR.test(ch)) return false
  }
  return false
}

/** Split into directional runs and return them in visual (left-to-right) order. */
export function visualRuns(text: string): Run[] {
  const rtlPara = paragraphRtl(text)
  const chars = [...text]
  // 1. Classify: strong R, strong L, number (N#), or neutral (null).
  const cls: (Dir | '#' | null)[] = chars.map((c) => (RTL.test(c) ? 'R' : LTR.test(c) ? 'L' : DIGIT.test(c) ? '#' : null))
  // Number separators between digits (1,000.50 / 10:30 / 1/2) belong to the number.
  for (let i = 1; i < chars.length - 1; i++) if (cls[i] === null && /[.,:/٫٬]/.test(chars[i]) && cls[i - 1] === '#' && cls[i + 1] === '#') cls[i] = '#'
  // 2. Numbers are left-to-right runs.
  const dir: (Dir | null)[] = cls.map((c) => (c === 'R' ? 'R' : c === 'L' || c === '#' ? 'L' : null))
  // For resolving neutrals, a number counts as the paragraph direction (UBA rule N1 treats numbers as R
  // in right-to-left text), so "صفحة 3 من 10" keeps its spaces inside the Arabic run.
  const strong = cls.map((c) => (c === '#' ? (rtlPara ? 'R' : 'L') : c))
  // 3. Neutrals: same strong direction on both sides → that direction, else the paragraph direction.
  for (let i = 0; i < chars.length; i++) {
    if (dir[i]) continue
    let j = i
    while (j < chars.length && !dir[j]) j++
    const before = i > 0 ? strong[i - 1] : rtlPara ? 'R' : 'L'
    const after = j < chars.length ? strong[j] : rtlPara ? 'R' : 'L'
    const d: Dir = before && before === after ? before : rtlPara ? 'R' : 'L'
    for (let k = i; k < j; k++) dir[k] = d
  }
  // 4. Group into runs (logical order).
  const runs: Run[] = []
  for (let i = 0; i < chars.length; i++) {
    const rtl = dir[i] === 'R'
    const last = runs[runs.length - 1]
    if (last && last.rtl === rtl) last.text += chars[i]
    else runs.push({ text: chars[i], rtl })
  }
  // 5. Visual order: in an RTL paragraph the run sequence is reversed (each run keeps its own direction).
  return rtlPara ? runs.reverse() : runs
}

export function textWidth(font: PDFFont, text: string, size: number): number {
  return visualRuns(text).reduce((w, r) => w + font.widthOfTextAtSize(r.text, size), 0)
}

export interface DrawTextOptions {
  font: PDFFont
  size: number
  /** Baseline origin in user space, and the text angle (degrees, counter-clockwise). */
  x: number
  y: number
  angle: number
  color: [number, number, number]
  opacity?: number
}

/** Draw a (possibly mixed-direction) line starting at its visual left edge. */
export function drawLine(page: PDFPage, text: string, o: DrawTextOptions) {
  const rad = (o.angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  let offset = 0
  for (const run of visualRuns(text)) {
    if (!run.text) continue
    page.drawText(run.text, {
      x: o.x + offset * cos,
      y: o.y + offset * sin,
      size: o.size,
      font: o.font,
      color: rgb(...o.color),
      opacity: o.opacity,
      rotate: degrees(o.angle),
    })
    offset += o.font.widthOfTextAtSize(run.text, o.size)
  }
}

/** "#RRGGBB" → [r, g, b] in 0–1. Invalid input → black. */
export function parseColor(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [0, 0, 0]
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export { toRoman, toArabicIndic } from './labels'
