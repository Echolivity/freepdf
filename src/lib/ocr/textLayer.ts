/**
 * Searchable PDFs: an invisible text layer (text render mode 3) over scanned pages, so the text can be
 * selected, searched and copied while the page looks exactly as before. Runs in the PDF worker.
 *
 * Each word arrives with its text matrix in the page's user space: the direction of its baseline, the
 * "up" direction, its origin (left end of the baseline), its type size and the width it covers. The
 * word is drawn in IBM Plex Sans Arabic (covers Latin and Arabic) and squeezed or stretched (Tz) to
 * exactly that width, so selection highlights line up with the scanned words. Mixed-direction words
 * are drawn as directional runs in visual order, like other text FreePDF writes.
 */
import { type PDFDocument, beginText, endText, popGraphicsState, pushGraphicsState, setCharacterSqueeze, setFontAndSize, setTextMatrix, setTextRenderingMode, showText, TextRenderingMode } from 'pdf-lib'
import { loadPdf, noProgress, saveDoc, type NamedBytes, type ProgressFn } from '../pdf/core'
import { fontBytes } from '../pdf/fonts'
import { visualRuns } from '../pdf/text'
import { UserFacingError } from '../validate'

export interface LayerWord {
  text: string
  /** [baseline x, baseline y, up x, up y, origin x, origin y]: unit vectors and origin in user space. */
  m: [number, number, number, number, number, number]
  /** Type size, in user-space units. */
  size: number
  /** Length of the word along its baseline, in user-space units. */
  width: number
}
export interface LayerPage { index: number; words: LayerWord[] }

export async function addTextLayer(input: NamedBytes, pages: LayerPage[], onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  const doc = await loadPdf(input.bytes, input.name)
  await drawTextLayer(doc, pages, onProgress)
  return saveDoc(doc)
}

/** Draw invisible text-layer words onto pages of an open document (also used by Redact PDF). */
export async function drawTextLayer(doc: PDFDocument, pages: LayerPage[], onProgress: ProgressFn = noProgress): Promise<void> {
  const count = doc.getPageCount()
  for (const p of pages) if (!Number.isInteger(p.index) || p.index < 0 || p.index >= count) throw new UserFacingError('err.pageMissing', { page: p.index + 1, count })
  const withWords = pages.filter((p) => p.words.length)
  if (withWords.length) {
    // The font only has to give each character a glyph: render mode 3 never paints it. Ligatures are off
    // so every glyph stands for exactly one character; a ligature (لا, لي) maps to two characters, which
    // copy and search then get in the wrong order once right-to-left text is put back in reading order.
    const fontkit = (await import('@pdf-lib/fontkit')).default
    doc.registerFontkit(fontkit)
    const font = await doc.embedFont(await fontBytes('IBMPlexSansArabic-Regular.ttf'), {
      subset: false,
      features: { liga: false, rlig: false, dlig: false, clig: false, calt: false },
    })
    withWords.forEach((p, k) => {
      const page = doc.getPage(p.index)
      const key = page.node.newFontDictionary(font.name, font.ref)
      const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)]
      for (const w of p.words) {
        const runs = visualRuns(w.text).filter((r) => r.text)
        const natural = runs.reduce((s, r) => s + font.widthOfTextAtSize(r.text, w.size), 0)
        if (!(natural > 0) || !(w.size > 0) || !(w.width > 0)) continue
        const scale = Math.min(20, Math.max(0.05, w.width / natural))
        const [bx, by, ux, uy, ox, oy] = w.m
        ops.push(setFontAndSize(key, w.size), setCharacterSqueeze(scale * 100))
        let off = 0
        for (const r of runs) {
          ops.push(setTextMatrix(bx, by, ux, uy, ox + off * bx, oy + off * by), showText(font.encodeText(r.text)))
          off += font.widthOfTextAtSize(r.text, w.size) * scale
        }
      }
      ops.push(endText(), popGraphicsState())
      page.pushOperators(...ops)
      onProgress((k + 1) / withWords.length)
    })
  }
}
