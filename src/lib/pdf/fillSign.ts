/**
 * Fill & Sign: fill a PDF's form fields and place text, ticks, crosses, dates and signatures anywhere on
 * its pages. Runs in the PDF worker.
 *
 * Form fields keep working (the result can still be filled in) unless `flatten` is set, which turns the
 * answers into ordinary page content. Text a standard font can't show (Arabic, for one) gets an
 * appearance drawn here with IBM Plex Sans Arabic in visual order, so it shows correctly in every viewer;
 * pdf-lib's own appearances would use Helvetica, which has no Arabic. Checkbox and radio appearances
 * are the form's own: only their state changes. Nothing in the form (scripts, calculations) is run.
 */
import {
  beginMarkedContent, beginText, clip, endMarkedContent, endPath, endText, popGraphicsState, pushGraphicsState, rectangle, rgb, degrees,
  setFillingRgbColor, setFontAndSize, setTextMatrix, showText, StandardFonts, TextAlignment,
  PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField,
  PDFDict, PDFName, PDFRef,
  type PDFDocument, type PDFField, type PDFFont, type PDFOperator, type PDFPage, type PDFWidgetAnnotation,
} from 'pdf-lib'
import { loadPdf, noProgress, saveDoc, type NamedBytes, type ProgressFn } from './core'
import { fitsStandardFont, fontFor } from './fonts'
import { drawLine, paragraphRtl, textWidth, visualRuns } from './text'

export type FieldValue =
  | { name: string; kind: 'text'; value: string }
  | { name: string; kind: 'check'; value: boolean }
  | { name: string; kind: 'radio'; value: string }
  | { name: string; kind: 'choice'; value: string[] }

/**
 * Something placed on a page. (x, y) is the item's bottom-left corner in the page's user space, and
 * `angle` the direction of its bottom edge (degrees, counter-clockwise), so items stay upright on pages
 * displayed rotated. w and h are in points.
 */
export interface PlacedItem {
  page: number
  kind: 'text' | 'mark' | 'image'
  x: number
  y: number
  w: number
  h: number
  angle: number
  /** kind 'text': one or more lines. */
  text?: string
  /** Type size in points (kind 'text'). */
  size?: number
  mark?: 'check' | 'cross'
  /** kind 'image': PNG bytes (signatures, with a transparent background). */
  png?: Uint8Array
  /** "#RRGGBB"; defaults to near-black ink. */
  color?: string
}

export interface FillSignOptions {
  fields: FieldValue[]
  items: PlacedItem[]
  flatten: boolean
}

export interface FillSignResult {
  bytes: Uint8Array
  /** Field names that couldn't be set (missing, or a different kind than expected). */
  skipped: string[]
}

const INK: [number, number, number] = [0.07, 0.09, 0.15]

function hex(c: string | undefined): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(c ?? '')
  if (!m) return INK
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** The type size in a field's default appearance (/DA "… 12 Tf"); 0 means "fit". */
function daSize(field: PDFField): number {
  const da = (field.acroField as unknown as { getDefaultAppearance(): string | undefined }).getDefaultAppearance?.() ?? ''
  const m = /([\d.]+)\s+Tf/.exec(da)
  return m ? Number(m[1]) : 0
}

/** Break text into lines that fit `width` (spaces; a single long word stays on its own line). */
function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = []
  for (const para of text.split(/\r?\n/)) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (line && textWidth(font, next, size) > width) { out.push(line); line = word } else line = next
    }
    out.push(line)
  }
  return out
}

/**
 * Appearance for text in a field box: right-to-left text drawn in visual order, aligned as the field
 * says (left-aligned fields get right-to-left text on the right, where it starts), multi-line fields
 * wrapped, comb fields one character per cell, and the size fitted when the field asks for auto size.
 */
function textAppearance(font: PDFFont, lines: string[], widget: PDFWidgetAnnotation, o: { size: number; multiline: boolean; align: TextAlignment; comb?: number }): PDFOperator[] {
  const { width, height } = widget.getRectangle()
  const pad = 2
  const inner = width - pad * 2
  // The declared size is a hint: forms often carry an auto-computed size for an empty box (pdf-lib
  // writes 56 pt for a tall multi-line field), so keep it within what fits.
  let size = o.size
  if (o.multiline && size > 24) size = 0
  if (!o.multiline && size > height * 0.8) size = height * 0.75
  if (!size) {
    size = o.multiline ? 10 : Math.min(12, Math.max(4, height * 0.7))
    if (!o.multiline) {
      const widest = Math.max(1, ...lines.map((l) => textWidth(font, l, size)))
      if (widest > inner) size = Math.max(4, (size * inner) / widest)
    }
  }
  const text = o.multiline ? wrap(font, lines.join('\n'), size, inner) : [lines.join(' ')]
  const ops: PDFOperator[] = [beginMarkedContent('Tx'), pushGraphicsState(), rectangle(1, 1, width - 2, height - 2), clip(), endPath(), beginText(), setFillingRgbColor(...INK), setFontAndSize(font.name, size)]
  const lineH = size * 1.2
  const firstBase = o.multiline ? height - pad - size * 0.95 : (height - size * 0.7) / 2
  text.forEach((line, i) => {
    const y = firstBase - i * lineH
    if (o.comb && o.comb > 0) {
      const cell = width / o.comb
      ;[...line].slice(0, o.comb).forEach((ch, k) => {
        const w = font.widthOfTextAtSize(ch, size)
        ops.push(setTextMatrix(1, 0, 0, 1, k * cell + (cell - w) / 2, y), showText(font.encodeText(ch)))
      })
      return
    }
    const w = textWidth(font, line, size)
    const rtl = paragraphRtl(line)
    const align = o.align === TextAlignment.Left && rtl ? TextAlignment.Right : o.align
    let x = align === TextAlignment.Center ? (width - w) / 2 : align === TextAlignment.Right ? width - pad - w : pad
    for (const r of visualRuns(line)) {
      if (!r.text) continue
      ops.push(setTextMatrix(1, 0, 0, 1, x, y), showText(font.encodeText(r.text)))
      x += font.widthOfTextAtSize(r.text, size)
    }
  })
  ops.push(endText(), popGraphicsState(), endMarkedContent())
  return ops
}

async function fontsFor(doc: PDFDocument) {
  let helv: PDFFont | null = null
  let plex: PDFFont | null = null
  return async (text: string) => {
    if (fitsStandardFont(text)) return (helv ??= await doc.embedFont(StandardFonts.Helvetica))
    return (plex ??= await fontFor(doc, 'plex', false, ['ا']))
  }
}

/** Draw (or redraw) the appearance of a text field or choice field. */
async function appear(field: PDFTextField | PDFDropdown | PDFOptionList, pick: (t: string) => Promise<PDFFont>) {
  if (field instanceof PDFTextField) {
    const value = field.getText() ?? ''
    const font = await pick(value)
    const comb = field.isCombed() ? field.getMaxLength() : undefined
    field.updateAppearances(font, (_f, widget, f) => textAppearance(f, [value], widget, { size: daSize(field), multiline: field.isMultiline(), align: field.getAlignment(), comb }))
  } else {
    const shown = field.getSelected()
    const font = await pick(shown.join(' '))
    field.updateAppearances(font, (_f, widget, f) => textAppearance(f, field instanceof PDFDropdown ? [shown[0] ?? ''] : shown, widget, { size: daSize(field), multiline: field instanceof PDFOptionList, align: TextAlignment.Left }))
  }
}

/** Point (lx, ly) in an item's own frame (origin bottom-left, x along its bottom edge) → user space. */
function at(item: PlacedItem, lx: number, ly: number): [number, number] {
  const a = (item.angle * Math.PI) / 180
  return [item.x + lx * Math.cos(a) - ly * Math.sin(a), item.y + lx * Math.sin(a) + ly * Math.cos(a)]
}

async function drawItem(doc: PDFDocument, page: PDFPage, item: PlacedItem, pick: (t: string) => Promise<PDFFont>) {
  const color = hex(item.color)
  if (item.kind === 'text' && item.text?.trim()) {
    const size = item.size ?? 12
    const lines = item.text.split(/\r?\n/)
    const font = await pick(item.text)
    lines.forEach((line, i) => {
      const w = textWidth(font, line, size)
      const rtl = paragraphRtl(line)
      // Right-to-left lines start at the right edge of the box.
      const lx = rtl ? Math.max(0, item.w - w) : 0
      const [x, y] = at(item, lx, item.h - size * (0.95 + i * 1.2))
      drawLine(page, line, { font, size, x, y, angle: item.angle, color })
    })
  } else if (item.kind === 'mark') {
    const t = Math.max(0.8, Math.min(item.w, item.h) * 0.12)
    const seg = (a: [number, number], b: [number, number]) =>
      page.drawLine({ start: { x: at(item, ...a)[0], y: at(item, ...a)[1] }, end: { x: at(item, ...b)[0], y: at(item, ...b)[1] }, thickness: t, color: rgb(...color), lineCap: 1 })
    const { w, h } = item
    if (item.mark === 'cross') { seg([w * 0.15, h * 0.15], [w * 0.85, h * 0.85]); seg([w * 0.15, h * 0.85], [w * 0.85, h * 0.15]) }
    else { seg([w * 0.12, h * 0.5], [w * 0.4, h * 0.18]); seg([w * 0.4, h * 0.18], [w * 0.9, h * 0.85]) }
  } else if (item.kind === 'image' && item.png?.length) {
    const img = await doc.embedPng(item.png)
    page.drawImage(img, { x: item.x, y: item.y, width: item.w, height: item.h, rotate: degrees(item.angle) })
  }
}

/**
 * After flattening, pdf-lib deletes the field objects but can leave the pages' /Annots pointing at
 * them (they then read as null, and some readers warn about the cross-reference table). Keep only
 * annotations that still exist and aren't form widgets.
 */
function dropDanglingAnnots(doc: PDFDocument) {
  const ANNOTS = PDFName.of('Annots')
  const WIDGET = PDFName.of('Widget')
  for (const page of doc.getPages()) {
    const annots = page.node.Annots()
    if (!annots) continue
    const keep = annots.asArray().filter((a) => {
      const obj = a instanceof PDFRef ? doc.context.lookup(a) : a
      return obj instanceof PDFDict && obj.get(PDFName.of('Subtype')) !== WIDGET
    })
    if (keep.length === annots.size()) continue
    if (keep.length) page.node.set(ANNOTS, doc.context.obj(keep))
    else page.node.delete(ANNOTS)
  }
}

export async function fillSign(input: NamedBytes, o: FillSignOptions, onProgress: ProgressFn = noProgress): Promise<FillSignResult> {
  const doc = await loadPdf(input.bytes, input.name)
  const pick = await fontsFor(doc)
  const skipped: string[] = []
  const touched: (PDFTextField | PDFDropdown | PDFOptionList)[] = []
  if (o.fields.length || o.flatten) {
    const form = doc.getForm()
    // A hybrid XFA form also carries the XFA version; viewers that prefer it would show the old values.
    if (o.fields.length && form.hasXFA()) form.deleteXFA()
    for (const v of o.fields) {
      let field: PDFField
      try { field = form.getField(v.name) } catch { skipped.push(v.name); continue }
      try {
        if (v.kind === 'text' && field instanceof PDFTextField) {
          const max = field.getMaxLength()
          field.setText(max !== undefined ? v.value.slice(0, max) : v.value)
          touched.push(field)
        } else if (v.kind === 'check' && field instanceof PDFCheckBox) {
          if (v.value) field.check(); else field.uncheck()
        } else if (v.kind === 'radio' && field instanceof PDFRadioGroup) {
          if (v.value) field.select(v.value); else field.clear()
        } else if (v.kind === 'choice' && (field instanceof PDFDropdown || field instanceof PDFOptionList)) {
          if (v.value.length) field.select(field instanceof PDFDropdown ? v.value[0] : v.value); else field.clear()
          touched.push(field)
        } else skipped.push(v.name)
      } catch { skipped.push(v.name) }
    }
    for (const f of touched) await appear(f, pick)
    onProgress(0.4)
    if (o.flatten) {
      // Every field needs an appearance to be flattened; give one to fields that have none yet.
      for (const f of form.getFields()) {
        if ((f instanceof PDFTextField || f instanceof PDFDropdown || f instanceof PDFOptionList) && !touched.includes(f) && f.needsAppearancesUpdate()) await appear(f, pick)
      }
      form.flatten({ updateFieldAppearances: false })
      dropDanglingAnnots(doc)
      if (!form.getFields().length) doc.catalog.delete(PDFName.of('AcroForm'))
    }
  }
  const pages = doc.getPages()
  for (let i = 0; i < o.items.length; i++) {
    const it = o.items[i]
    if (it.page < 0 || it.page >= pages.length) continue
    await drawItem(doc, pages[it.page], it, pick)
    onProgress(0.4 + ((i + 1) / o.items.length) * 0.5)
  }
  return { bytes: await saveDoc(doc), skipped }
}
