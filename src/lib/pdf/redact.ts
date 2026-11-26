/**
 * Redact PDF (worker side). Each page with redactions is rebuilt from a picture of itself with the
 * black boxes burnt in (rendered in the browser), so whatever was under a box — text, images, vector
 * art, form values — is gone from the file, not just covered. The words outside the boxes come back
 * as an invisible text layer, so the rest of the page can still be searched and copied.
 *
 * Nothing of the old page survives: its content streams, resources, annotations, thumbnail and form
 * fields are dropped and every object no longer reachable is deleted before saving, so the original
 * page can't be recovered from the file. The tagged-PDF structure tree goes too, because it can hold
 * the page's text (alt text, actual text). Optionally, hidden information is removed as well:
 * metadata, bookmarks, attached files and scripts.
 */
import { PDFArray, PDFDict, PDFName, PDFRawStream, PDFRef, decodePDFRawStream, type PDFContext, type PDFDocument, type PDFPage } from 'pdf-lib'
import { loadPdf, noProgress, saveDoc, type NamedBytes, type ProgressFn } from './core'
import { pushDownInherited, removeUnreachable } from './structure'
import { drawTextLayer, type LayerWord } from '../ocr/textLayer'
import { UserFacingError } from '../validate'

export interface RedactPage {
  /** 0-based page index. */
  index: number
  /** The page as displayed, with the boxes burnt in (JPEG). */
  jpeg: Uint8Array
  /** Displayed page size in points; the rebuilt page gets this size, unrotated. */
  width: number
  height: number
  /** Words to keep searchable, in the rebuilt page's user space (origin bottom-left). */
  words: LayerWord[]
}
export interface RedactOptions {
  pages: RedactPage[]
  /** Also remove metadata, bookmarks, attached files and scripts. */
  sanitize: boolean
}
export interface RedactResult {
  bytes: Uint8Array
  pages: number
  /** Form fields removed because they were on a redacted page. */
  fields: number
}

const N = (s: string) => PDFName.of(s)
const PAGE_KEYS_TO_DROP = ['Annots', 'Thumb', 'PieceInfo', 'Metadata', 'B', 'StructParents', 'AA', 'Group', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox', 'BoxColorInfo', 'UserUnit', 'SeparationInfo', 'Contents', 'Resources']

const latin1 = new TextDecoder('latin1')

/** A page's content streams, decoded, as one string (empty if a filter can't be decoded here). */
function contentText(page: PDFPage): string | null {
  const ctx = page.doc.context
  const c = page.node.get(N('Contents'))
  const refs = c instanceof PDFArray ? c.asArray() : c ? [c] : []
  let out = ''
  for (const r of refs) {
    const s = ctx.lookup(r)
    if (!(s instanceof PDFRawStream)) continue
    try { out += latin1.decode(decodePDFRawStream(s).decode()) + '\n' } catch { return null }
  }
  return out
}

/**
 * Pages that shared a resource dictionary with a redacted page could keep its pictures reachable (and
 * so in the file). Give each such page its own resources without XObjects it doesn't use itself.
 */
function unshareResources(doc: PDFDocument, redactedXObjects: Set<string>, redacted: Set<number>) {
  const ctx = doc.context
  doc.getPages().forEach((page, i) => {
    if (redacted.has(i)) return
    const res = page.node.lookupMaybe(N('Resources'), PDFDict)
    const xo = res?.lookupMaybe(N('XObject'), PDFDict)
    if (!res || !xo) return
    const content = contentText(page)
    const unused = xo.entries().filter(([name, ref]) => {
      if (!(ref instanceof PDFRef) || !redactedXObjects.has(ref.tag)) return false
      if (content === null) return false
      const escaped = name.asString().slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return !new RegExp(`/${escaped}(?![^\\s/\\[\\]<>(){}%])`).test(content)
    })
    if (!unused.length) return
    const ownXo = ctx.obj({}) as PDFDict
    for (const [name, ref] of xo.entries()) if (!unused.some(([n]) => n === name)) ownXo.set(name, ref)
    const ownRes = ctx.obj({}) as PDFDict
    for (const [k, v] of res.entries()) ownRes.set(k, k === N('XObject') ? ownXo : v)
    page.node.set(N('Resources'), ownRes)
  })
}

/** Remove form fields (and empty parents) whose widgets were on redacted pages. Returns fields removed. */
function pruneFields(doc: PDFDocument, gone: Set<string>): number {
  const ctx = doc.context
  const acro = doc.catalog.lookupMaybe(N('AcroForm'), PDFDict)
  const fields = acro?.lookupMaybe(N('Fields'), PDFArray)
  if (!acro || !fields) return 0
  let removed = 0
  const prune = (arr: PDFArray): void => {
    for (let i = arr.size() - 1; i >= 0; i--) {
      const ref = arr.get(i)
      const node = ctx.lookup(ref)
      const kids = node instanceof PDFDict ? node.lookupMaybe(N('Kids'), PDFArray) : undefined
      // A field is a node with a name (/T) whose kids, if any, are widgets (no names of their own).
      const isField = node instanceof PDFDict && !!node.get(N('T')) && !(kids?.asArray().some((k) => (ctx.lookup(k) as PDFDict | undefined)?.get?.(N('T'))))
      if (ref instanceof PDFRef && gone.has(ref.tag)) { arr.remove(i); if (isField) removed++; continue }
      if (kids && kids.size()) {
        prune(kids)
        if (!kids.size()) { arr.remove(i); if (isField) removed++ }
      }
    }
  }
  prune(fields)
  if (!fields.size()) doc.catalog.delete(N('AcroForm'))
  return removed
}

/** Remove what a reader doesn't see but a file still carries: metadata, bookmarks, attachments, scripts. */
function sanitize(doc: PDFDocument, ctx: PDFContext) {
  ctx.trailerInfo.Info = undefined
  const cat = doc.catalog
  for (const k of ['Metadata', 'Outlines', 'AA', 'PieceInfo', 'Threads', 'SpiderInfo', 'Collection', 'AF']) cat.delete(N(k))
  if (cat.get(N('PageMode')) === N('UseOutlines') || cat.get(N('PageMode')) === N('UseAttachments')) cat.delete(N('PageMode'))
  const open = cat.lookup(N('OpenAction'))
  if (open instanceof PDFDict) cat.delete(N('OpenAction'))
  const names = cat.lookupMaybe(N('Names'), PDFDict)
  if (names) for (const k of ['JavaScript', 'EmbeddedFiles', 'AlternatePresentations']) names.delete(N(k))
  for (const page of doc.getPages()) {
    page.node.delete(N('AA'))
    page.node.delete(N('Metadata'))
    page.node.delete(N('PieceInfo'))
    const annots = page.node.lookupMaybe(N('Annots'), PDFArray)
    if (!annots) continue
    // Attached files and sounds/movies carry content of their own.
    for (let i = annots.size() - 1; i >= 0; i--) {
      const a = ctx.lookup(annots.get(i))
      const sub = a instanceof PDFDict ? a.get(N('Subtype')) : undefined
      if (sub === N('FileAttachment') || sub === N('Sound') || sub === N('Movie') || sub === N('Screen') || sub === N('RichMedia')) annots.remove(i)
    }
  }
  const acro = cat.lookupMaybe(N('AcroForm'), PDFDict)
  acro?.delete(N('XFA'))
}

export async function redact(input: NamedBytes, o: RedactOptions, onProgress: ProgressFn = noProgress): Promise<RedactResult> {
  const doc = await loadPdf(input.bytes, input.name)
  const ctx = doc.context
  const count = doc.getPageCount()
  if (!o.pages.length) throw new UserFacingError('rd.nothing')
  const seen = new Set<number>()
  for (const p of o.pages) {
    if (!Number.isInteger(p.index) || p.index < 0 || p.index >= count || seen.has(p.index)) throw new UserFacingError('err.pageMissing', { page: p.index + 1, count })
    seen.add(p.index)
  }

  // Resources inherited from the page tree are copied onto each page, and dropped from the tree, so the
  // old page's resources can't stay reachable through its parents.
  pushDownInherited(doc)
  const dropFromTree = (node: PDFDict, depth: number) => {
    if (depth > 64) return
    const kids = node.lookupMaybe(N('Kids'), PDFArray)
    if (!kids) return
    node.delete(N('Resources'))
    for (const k of kids.asArray()) {
      const child = ctx.lookup(k)
      if (child instanceof PDFDict && child.get(N('Type')) === N('Pages')) dropFromTree(child, depth + 1)
    }
  }
  dropFromTree(doc.catalog.Pages(), 0)

  const redactedXObjects = new Set<string>()
  const gone = new Set<string>()
  for (let k = 0; k < o.pages.length; k++) {
    const p = o.pages[k]
    const page = doc.getPage(p.index)
    const node = page.node
    const annots = node.lookupMaybe(N('Annots'), PDFArray)
    annots?.asArray().forEach((r) => { if (r instanceof PDFRef) gone.add(r.tag) })
    node.lookupMaybe(N('Resources'), PDFDict)?.lookupMaybe(N('XObject'), PDFDict)?.values().forEach((r) => { if (r instanceof PDFRef) redactedXObjects.add(r.tag) })
    // Start the page over: only the picture (and later the invisible words) remain.
    for (const key of PAGE_KEYS_TO_DROP) node.delete(N(key))
    node.set(N('Resources'), ctx.obj({}))
    node.set(N('MediaBox'), ctx.obj([0, 0, p.width, p.height]))
    node.set(N('Rotate'), ctx.obj(0))
    const img = await doc.embedJpg(p.jpeg)
    page.drawImage(img, { x: 0, y: 0, width: p.width, height: p.height })
    onProgress(((k + 1) / o.pages.length) * 0.6)
  }

  await drawTextLayer(doc, o.pages.map((p) => ({ index: p.index, words: p.words })), (f) => onProgress(0.6 + f * 0.25))

  unshareResources(doc, redactedXObjects, seen)
  const fields = pruneFields(doc, gone)
  // The structure tree can carry the redacted text (alt text, actual text): it can't be kept.
  doc.catalog.delete(N('StructTreeRoot'))
  doc.catalog.delete(N('MarkInfo'))
  if (o.sanitize) sanitize(doc, ctx)
  removeUnreachable(ctx)
  onProgress(0.95)
  return { bytes: await saveDoc(doc), pages: o.pages.length, fields }
}
