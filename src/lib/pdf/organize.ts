import { PDFDocument, degrees } from 'pdf-lib'
import { UserFacingError } from '../validate'
import { msg } from '../../i18n/core'
export { chunkGroups } from '../ranges'
import { assemble, copyDocumentInfo, loadPdf, normalizeAngle, saveDoc, noProgress, type NamedBytes, type ProgressFn } from './core'
import { rebuildPageTree } from './structure'

/** Splits with at most this many parts re-parse the source per part, so each part keeps forms/bookmarks. */
const MAX_FULL_FIDELITY_PARTS = 40

/**
 * Keep pages in `ops` order, editing the original document in place so forms, bookmarks, links,
 * metadata and attachments survive. Falls back to copying pages only when a page repeats.
 */
async function rearrange(input: NamedBytes, ops: PageOp[]): Promise<Uint8Array> {
  const src = await loadPdf(input.bytes, input.name)
  assertIndices(ops.map((o) => o.index), src.getPageCount())
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

function assertIndices(indices: number[], count: number) {
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0 || i >= count) throw new UserFacingError('err.pageMissing', { page: i + 1, count })
  }
}
