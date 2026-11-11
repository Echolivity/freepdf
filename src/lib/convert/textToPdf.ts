import { PDFDocument, type PDFFont } from 'pdf-lib'
import { UserFacingError } from '../validate'
import { msg } from '../../i18n/core'
import { saveDoc, noProgress, type NamedBytes, type ProgressFn } from '../pdf/core'
import { fitsStandardFont, fontFor } from '../pdf/fonts'
import { drawLine, paragraphRtl, textWidth } from '../pdf/text'

export type TextEncoding = 'auto' | 'utf-8' | 'windows-1252' | 'windows-1256'

export interface TextToPdfOptions {
  pageSize: 'a4' | 'letter'
  orientation: 'portrait' | 'landscape'
  /** Margin in PDF points. */
  margin: number
  font: 'helvetica' | 'times' | 'courier'
  /** Font size in points. */
  size: number
  encoding: TextEncoding
}

export interface TextToPdfResult {
  pdf: Uint8Array
  pages: number
  /** The encoding actually used to read the file. */
  encoding: string
  /** 'auto' found no byte-order mark and the bytes weren't valid UTF-8, so Windows-1252 was assumed. */
  guessed: boolean
  /** The chosen standard font couldn't show the text (e.g. Arabic), so IBM Plex Sans Arabic was used. */
  fontSwitched: boolean
  /** Up to 12 characters that no available font contains (shown as boxes). */
  missing: string[]
}

const SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const
/** Above this the PDF would run to tens of thousands of pages; better to say so than to stall the tab. */
const MAX_CHARS = 20_000_000
const MAX_PAGES = 20_000
const TAB = 4

/** Decode text bytes: a byte-order mark wins, then the chosen encoding; 'auto' tries UTF-8 first. */
export function decodeText(bytes: Uint8Array, choice: TextEncoding): { text: string; encoding: string; guessed: boolean } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'UTF-8', guessed: false }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16', guessed: false }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16', guessed: false }
  if (choice === 'auto') {
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8', guessed: false }
    } catch {
      return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'Windows-1252', guessed: true }
    }
  }
  const label = { 'utf-8': 'UTF-8', 'windows-1252': 'Windows-1252', 'windows-1256': 'Windows-1256' }[choice]
  return { text: new TextDecoder(choice).decode(bytes), encoding: label, guessed: false }
}

/** Expand tabs to the next tab stop and drop control characters that have no visible meaning. */
export function cleanLine(line: string): string {
  let out = ''
  for (const ch of line) {
    if (ch === '\t') out += ' '.repeat(TAB - ([...out].length % TAB))
    else if (ch < ' ' || ch === '\x7f') continue
    else out += ch
  }
  return out
}

/** Greedy word wrap by measured width. Words wider than a line are broken between characters. */
export function wrapLine(line: string, maxWidth: number, measure: (s: string) => number): string[] {
  if (!line.trim()) return ['']
  const lines: string[] = []
  let current = ''
  let width = 0
  const push = () => { lines.push(current.replace(/\s+$/, '')); current = ''; width = 0 }
  for (const token of line.match(/\s+|\S+/g) ?? []) {
    const w = measure(token)
    if (width + w <= maxWidth || !current) {
      if (w <= maxWidth || /^\s+$/.test(token)) {
        if (!current && /^\s+$/.test(token) && lines.length) continue // no leading spaces on wrapped lines
        current += token
        width += w
        continue
      }
      // A single word longer than the line: break it.
      for (const ch of token) {
        const cw = measure(ch)
        if (width + cw > maxWidth && current) push()
        current += ch
        width += cw
      }
      continue
    }
    push()
    if (/^\s+$/.test(token)) continue
    if (w <= maxWidth) { current = token; width = w; continue }
    for (const ch of token) {
      const cw = measure(ch)
      if (width + cw > maxWidth && current) push()
      current += ch
      width += cw
    }
  }
  if (current || !lines.length) push()
  return lines
}

export async function textToPdf(file: NamedBytes, o: TextToPdfOptions, onProgress: ProgressFn = noProgress): Promise<TextToPdfResult> {
  const { text: raw, encoding, guessed } = decodeText(file.bytes, o.encoding)
  if (raw.length > MAX_CHARS) throw new UserFacingError('err.textTooLong', { name: file.name })
  const text = raw.replace(/\r\n?/g, '\n')

  const doc = await PDFDocument.create()
  doc.setProducer('FreePDF')
  doc.setCreator('FreePDF')
  doc.setTitle(file.name.replace(/\.[^.]+$/, ''))
  // Line breaks, tabs and form feeds are layout, not glyphs: leave them out of the font check.
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  const visible = text.replace(/[\x00-\x1f\x7f]/g, '')
  const fontSwitched = !fitsStandardFont(visible)
  const font: PDFFont = await fontFor(doc, o.font, false, [visible])
  const missing = fontSwitched ? missingChars(font, text) : []

  const [sw, sh] = SIZES[o.pageSize]
  const [pageW, pageH] = o.orientation === 'landscape' ? [sh, sw] : [sw, sh]
  const size = Math.max(6, Math.min(o.size, 36))
  const margin = Math.max(18, Math.min(o.margin, 144))
  const lineH = size * (fontSwitched ? 1.6 : 1.4)
  const maxW = pageW - margin * 2
  const cache = new Map<string, number>()
  const measure = (s: string) => {
    let w = cache.get(s)
    if (w === undefined) {
      w = textWidth(font, s, size)
      if (cache.size < 50_000) cache.set(s, w)
    }
    return w
  }

  const sections = text.split('\f')
  let page = doc.addPage([pageW, pageH])
  let y = pageH - margin - size
  const newPage = () => {
    if (doc.getPageCount() >= MAX_PAGES) throw new UserFacingError('err.textTooLong', { name: file.name })
    page = doc.addPage([pageW, pageH])
    y = pageH - margin - size
  }
  let done = 0
  for (let s = 0; s < sections.length; s++) {
    if (s > 0) newPage()
    const lines = sections[s].split('\n')
    if (s === sections.length - 1 && lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
    for (const logical of lines) {
      const clean = cleanLine(logical)
      const rtl = paragraphRtl(clean)
      for (const line of wrapLine(clean, maxW, measure)) {
        if (y < margin) newPage()
        if (line) {
          const w = measure(line)
          drawLine(page, line, { font, size, x: rtl ? pageW - margin - w : margin, y, angle: 0, color: [0, 0, 0] })
        }
        y -= lineH
      }
      done += logical.length + 1
      if ((done & 0x3fff) < logical.length + 1) onProgress(Math.min(0.95, done / text.length), msg('prog.layingOut', { name: file.name }))
    }
  }
  onProgress(0.97, msg('prog.saving'))
  const pdf = await saveDoc(doc)
  onProgress(1)
  return { pdf, pages: doc.getPageCount(), encoding, guessed, fontSwitched, missing }
}

function missingChars(font: PDFFont, text: string): string[] {
  const have = new Set(font.getCharacterSet())
  const out = new Set<string>()
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if (c < 0x20 || /\s/.test(ch) || have.has(c)) continue
    out.add(ch)
    if (out.size >= 12) break
  }
  return [...out]
}
