import { PDFArray, PDFDict, PDFDocument, PDFName, PDFPage, degrees, type PDFPageLeaf, type PDFRef } from 'pdf-lib'
import { UserFacingError } from '../validate'
import { msg } from '../../i18n/core'
export { chunkGroups } from '../ranges'
import { assemble, copyDocumentInfo, loadPdf, normalizeAngle, saveDoc, noProgress, type NamedBytes, type ProgressFn } from './core'
import { pushDownInherited, rebuildPageTree } from './structure'

/** Splits with at most this many parts re-parse the source per part, so each part keeps forms/bookmarks. */
const MAX_FULL_FIDELITY_PARTS = 40

/**
 * Keep pages in `ops` order, editing the original document in place so forms, bookmarks, links,
 * metadata and attachments survive. Falls back to copying pages only when a page repeats.
 */
async function rearrange(input: NamedBytes, ops: PageOp[]): Promise<Uint8Array> {
  const src = await loadPdf(input.bytes, input.name)
  assertIndices(ops.map((o) => o.index), src.getPageCount())
  // Nothing to change (all pages, original order, no rotation): return the original bytes untouched,
  // so digital signatures, incremental-save history and everything else stay exactly as they were.
  if (isIdentity(ops, src.getPageCount())) return input.bytes
  if (new Set(ops.map((o) => o.index)).size !== ops.length) return assemble(src, ops)
  rebuildPageTree(src, ops)
  return saveDoc(src)
}

/** Merge PDFs in the given order. */
export async function mergePdfs(inputs: NamedBytes[], onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  if (inputs.length < 2) throw new UserFacingError('err.mergeTwo')
  const out = await PDFDocument.create()
  for (let i = 0; i < inputs.length; i++) {
    onProgress(i / inputs.length, msg('prog.adding', { name: inputs[i].name }))
    const src = await loadPdf(inputs[i].bytes, inputs[i].name)
    if (i === 0) copyDocumentInfo(src, out) // document info comes from the first file
    const pages = await out.copyPages(src, src.getPageIndices())
    pages.forEach((p) => out.addPage(p))
  }
  onProgress(0.95, msg('prog.saving'))
  const bytes = await saveDoc(out)
  onProgress(1)
  return bytes
}

/** Split into one document per page group. */
export async function splitPdf(
  input: NamedBytes,
  groups: number[][],
  onProgress: ProgressFn = noProgress,
): Promise<Uint8Array[]> {
  const src = await loadPdf(input.bytes, input.name)
  const count = src.getPageCount()
  assertIndices(groups.flat(), count)
  const results: Uint8Array[] = []
  const fullFidelity = groups.length <= MAX_FULL_FIDELITY_PARTS
  for (let i = 0; i < groups.length; i++) {
    onProgress(i / groups.length, msg('prog.part', { i: i + 1, n: groups.length }))
    const ops = groups[i].map((index) => ({ index }))
    results.push(fullFidelity ? await rearrange(input, ops) : await assemble(src, ops))
  }
  onProgress(1)
  return results
}

/** Keep only the given pages (in the given order). */
export async function extractPages(input: NamedBytes, indices: number[]): Promise<Uint8Array> {
  if (!indices.length) throw new UserFacingError('err.extractNone')
  return rearrange(input, indices.map((index) => ({ index })))
}

/** Delete the given pages. */
export async function removePages(input: NamedBytes, indices: number[]): Promise<Uint8Array> {
  const src = await loadPdf(input.bytes, input.name)
  const count = src.getPageCount()
  assertIndices(indices, count)
  const drop = new Set(indices)
  if (!drop.size) throw new UserFacingError('err.removeNone')
  if (drop.size >= count) throw new UserFacingError('err.removeAll')
  rebuildPageTree(src, src.getPageIndices().filter((i) => !drop.has(i)).map((index) => ({ index })))
  return saveDoc(src)
}

/** Rotate pages in place. `indices` null = all pages. Angle is added to existing rotation. */
export async function rotatePdf(input: NamedBytes, angle: number, indices: number[] | null = null): Promise<Uint8Array> {
  const src = await loadPdf(input.bytes, input.name)
  const pages = src.getPages()
  const targets = indices ?? pages.map((_, i) => i)
  assertIndices(targets, pages.length)
  for (const i of targets) pages[i].setRotation(degrees(normalizeAngle(pages[i].getRotation().angle + angle)))
  return saveDoc(src)
}

export interface PageOp {
  /** Original 0-based page index. */
  index: number
  /** Extra clockwise rotation in degrees (multiple of 90). */
  rotate?: number
}

/** Re-build a PDF from an ordered list of pages, with per-page rotation. Pages not listed are dropped. */
export async function organizePdf(input: NamedBytes, ops: PageOp[]): Promise<Uint8Array> {
  if (!ops.length) throw new UserFacingError('err.needOnePage')
  return rearrange(input, ops)
}

export async function getPageCount(input: NamedBytes): Promise<number> {
  return (await loadPdf(input.bytes, input.name)).getPageCount()
}

export function isIdentity(ops: PageOp[], count: number): boolean {
  return ops.length === count && ops.every((o, i) => o.index === i && !((o.rotate ?? 0) % 360))
}

function assertIndices(indices: number[], count: number) {
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0 || i >= count) throw new UserFacingError('err.pageMissing', { page: i + 1, count })
  }
}

/** One page of the arranged document: page `index` of source `src` (0 = the main file, 1… = inserted files). */
export interface ArrangeOp {
  src: number
  index: number
  rotate?: number
}

/**
 * Duplicate a page inside the same document. The copy shares the page's content and resources (no
 * bloat). Links, notes and other annotations are copied too; form-field widgets are not (a field can
 * only appear once per page object, and copying it would create a second, linked field), and neither
 * are pop-ups that belong to another annotation.
 */
function clonePage(doc: PDFDocument, page: PDFPage): PDFPage {
  const ctx = doc.context
  const leaf = page.node.clone(ctx) as PDFPageLeaf
  leaf.delete(PDFName.of('StructParents'))
  const ref = ctx.register(leaf)
  const annots = leaf.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (annots) {
    const copies: PDFRef[] = []
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i)
      if (!(a instanceof PDFDict)) continue
      const sub = a.get(PDFName.of('Subtype'))?.toString()
      if (sub === '/Widget' || sub === '/Popup') continue
      const c = a.clone(ctx)
      c.delete(PDFName.of('Popup'))
      c.delete(PDFName.of('StructParent'))
      c.set(PDFName.of('P'), ref)
      copies.push(ctx.register(c))
    }
    leaf.set(PDFName.of('Annots'), ctx.obj(copies))
  }
  return PDFPage.of(leaf, ref, doc)
}

/**
 * Build the final document from the main file plus pages from other PDFs, with duplicates and
 * rotation. The main file is edited in place (its forms, bookmarks, links, attachments and metadata
 * survive, pruned for pages that were dropped). Pages from inserted files are copied with their
 * content and annotations; their files' bookmarks and form fields are not merged.
 */
export async function arrangePages(main: NamedBytes, inserts: NamedBytes[], ops: ArrangeOp[], onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  if (!ops.length) throw new UserFacingError('err.needOnePage')
  const doc = await loadPdf(main.bytes, main.name)
  const count = doc.getPageCount()
  for (const o of ops) if (!Number.isInteger(o.src) || o.src < 0 || o.src > inserts.length) throw new UserFacingError('err.pageMissing', { page: o.index + 1, count })
  assertIndices(ops.filter((o) => o.src === 0).map((o) => o.index), count)
  const unique = new Set(ops.map((o) => `${o.src}:${o.index}`)).size === ops.length
  if (unique && ops.every((o) => o.src === 0) && isIdentity(ops, count)) return main.bytes

  pushDownInherited(doc)
  const base = doc.getPages()
  // Copy each inserted file's pages once.
  const copied = new Map<string, PDFPage>()
  for (let s = 1; s <= inserts.length; s++) {
    const need = [...new Set(ops.filter((o) => o.src === s).map((o) => o.index))]
    if (!need.length) continue
    onProgress((s - 1) / (inserts.length + 1), msg('prog.adding', { name: inserts[s - 1].name }))
    const other = await loadPdf(inserts[s - 1].bytes, inserts[s - 1].name)
    assertIndices(need, other.getPageCount())
    const pages = await doc.copyPages(other, need)
    need.forEach((idx, k) => copied.set(`${s}:${idx}`, pages[k]))
  }
  const used = new Set<string>()
  const order: { index: number; rotate?: number }[] = []
  const append = (p: PDFPage) => { doc.addPage(p); return doc.getPageCount() - 1 }
  for (const o of ops) {
    const k = `${o.src}:${o.index}`
    let idx: number
    if (o.src === 0) idx = used.has(k) ? append(clonePage(doc, base[o.index])) : o.index
    else {
      const page = copied.get(k)!
      idx = used.has(k) ? append(clonePage(doc, page)) : append(page)
    }
    used.add(k)
    order.push({ index: idx, rotate: o.rotate })
  }
  onProgress(0.9, msg('prog.saving'))
  rebuildPageTree(doc, order)
  const out = await saveDoc(doc)
  onProgress(1)
  return out
}
