import {
  PDFArray,
  PDFContentStream,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFStream,
  clip,
  concatTransformationMatrix,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  type PDFContext,
  type PDFPage,
  type PDFObject,
} from 'pdf-lib'
import { UserFacingError } from '../validate'
import { msg } from '../../i18n/core'
import { loadPdf, saveDoc, noProgress, type NamedBytes, type ProgressFn } from './core'

export { PAPER, planPage, type PaperName, type ResizeMode, type Orientation, type ResizeOptions } from './resizePlan'
import { planPage, type Matrix, type ResizeOptions } from './resizePlan'

/** Largest page side PDF allows (ISO 32000: 14,400 units without UserUnit). */
const MAX_SIDE = 14_400
const EPS = 0.01
const NEAR = 1

const apply = (mx: Matrix, x: number, y: number): [number, number] => [mx[0] * x + mx[4], mx[3] * y + mx[5]]

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function num(_ctx: PDFContext, n: number) {
  return PDFNumber.of(Math.round(n * 1000) / 1000)
}

/** Transform a flat [x y x y …] array of points in place. */
function transformPoints(ctx: PDFContext, arr: PDFArray | undefined, mx: Matrix) {
  if (!arr) return
  for (let i = 0; i + 1 < arr.size(); i += 2) {
    const x = arr.lookup(i)
    const y = arr.lookup(i + 1)
    if (!(x instanceof PDFNumber) || !(y instanceof PDFNumber)) continue
    const [nx, ny] = apply(mx, x.asNumber(), y.asNumber())
    arr.set(i, num(ctx, nx))
    arr.set(i + 1, num(ctx, ny))
  }
}

function transformRect(ctx: PDFContext, arr: PDFArray | undefined, mx: Matrix) {
  if (!arr || arr.size() !== 4) return
  transformPoints(ctx, arr, mx)
  // Keep the rectangle normalised (lower-left, upper-right).
  const v = [0, 1, 2, 3].map((i) => (arr.lookup(i) as PDFNumber).asNumber())
  arr.set(0, num(ctx, Math.min(v[0], v[2])))
  arr.set(1, num(ctx, Math.min(v[1], v[3])))
  arr.set(2, num(ctx, Math.max(v[0], v[2])))
  arr.set(3, num(ctx, Math.max(v[1], v[3])))
}

/** Move and scale every annotation (links, notes, highlights, form widgets…) with the content. */
function transformAnnotations(page: PDFPage, mx: Matrix) {
  const ctx = page.doc.context
  const annots = page.node.Annots()
  if (!annots) return
  for (let i = 0; i < annots.size(); i++) {
    const a = annots.lookup(i)
    if (!(a instanceof PDFDict)) continue
    const arr = (k: string) => a.lookupMaybe(PDFName.of(k), PDFArray)
    transformRect(ctx, arr('Rect'), mx)
    transformPoints(ctx, arr('QuadPoints'), mx)
    transformPoints(ctx, arr('L'), mx)
    transformPoints(ctx, arr('Vertices'), mx)
    transformPoints(ctx, arr('CL'), mx)
    const ink = arr('InkList')
    if (ink) for (let k = 0; k < ink.size(); k++) transformPoints(ctx, ink.lookupMaybe(k, PDFArray), mx)
  }
}

/** Wrap the page's existing content: q <matrix> cm <clip to old visible box> q …original… Q Q. */
function wrapContent(page: PDFPage, mx: Matrix, box: { x: number; y: number; width: number; height: number }) {
  const ctx = page.doc.context
  const stream = (...ops: Parameters<typeof PDFContentStream.of>[1]) => ctx.register(PDFContentStream.of(ctx.obj({}), ops))
  const start = stream(
    pushGraphicsState(),
    concatTransformationMatrix(...mx),
    rectangle(box.x, box.y, box.width, box.height),
    clip(),
    endPath(),
    pushGraphicsState(),
  )
  const end = stream(popGraphicsState(), popGraphicsState())
  const raw = page.node.get(PDFName.of('Contents'))
  const looked = raw ? ctx.lookup(raw) : undefined
  const items: PDFObject[] = []
  if (looked instanceof PDFArray) for (let i = 0; i < looked.size(); i++) items.push(looked.get(i))
  else if (looked instanceof PDFStream && raw) items.push(raw)
  page.node.set(PDFName.of('Contents'), ctx.obj([start, ...items, end]))
}

const BOXES = ['BleedBox', 'TrimBox', 'ArtBox'] as const

/**
 * Resize pages in place. Content is never rasterised or re-embedded: a transformation matrix is put in
 * front of each page's content, annotations are moved with it, and the page boxes are replaced. Text,
 * links, form fields, bookmarks and metadata keep working. Pages already at the target are untouched;
 * if nothing changes, the original bytes are returned.
 */
export async function resizePdf(input: NamedBytes, o: ResizeOptions, onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  if (!(o.width > 0 && o.height > 0) || o.width > MAX_SIDE || o.height > MAX_SIDE) throw new UserFacingError('err.resizeSize')
  const doc = await loadPdf(input.bytes, input.name)
  const pages = doc.getPages()
  const targets = o.indices ?? pages.map((_, i) => i)
  for (const i of targets) if (!Number.isInteger(i) || i < 0 || i >= pages.length) throw new UserFacingError('err.pageMissing', { page: i + 1, count: pages.length })
  let changed = 0
  for (let k = 0; k < targets.length; k++) {
    if (k % 25 === 0) onProgress(k / targets.length, msg('prog.page', { i: k + 1, n: targets.length }))
    const page = pages[targets[k]]
    const box = page.getCropBox()
    const media = page.getMediaBox()
    const plan = planPage(box, page.getRotation().angle, o)
    const sameBox = Math.abs(media.x - box.x) < EPS && Math.abs(media.y - box.y) < EPS && Math.abs(media.width - box.width) < EPS && Math.abs(media.height - box.height) < EPS
    // Already at the target size (within 1 pt ≈ 0.35 mm, e.g. A4 stored as 595 × 842): leave the page alone.
    const identity =
      sameBox && Math.abs(box.x) < EPS && Math.abs(box.y) < EPS && Math.abs(plan.scale - 1) < 0.005 &&
      Math.abs(plan.width - box.width) < NEAR && Math.abs(plan.height - box.height) < NEAR
    if (identity) continue
    changed++
    wrapContent(page, plan.matrix, box)
    transformAnnotations(page, plan.matrix)
    const ctx = doc.context
    for (const name of BOXES) {
      const arr = page.node.lookupMaybe(PDFName.of(name), PDFArray)
      if (!arr) continue
      transformRect(ctx, arr, plan.matrix)
      // Clip to the new page.
      const v = [0, 1, 2, 3].map((i) => (arr.lookup(i) as PDFNumber).asNumber())
      const c = [Math.max(0, v[0]), Math.max(0, v[1]), Math.min(plan.width, v[2]), Math.min(plan.height, v[3])]
      if (c[2] - c[0] < 1 || c[3] - c[1] < 1) page.node.delete(PDFName.of(name))
      else c.forEach((n, i) => arr.set(i, num(ctx, n)))
    }
    page.setMediaBox(0, 0, plan.width, plan.height)
    // Set explicitly: a CropBox inherited from the page tree would otherwise still apply.
    page.setCropBox(0, 0, plan.width, plan.height)
    page.node.delete(PDFName.of('UserUnit'))
  }
  onProgress(1)
  if (!changed) return input.bytes
  return saveDoc(doc)
}
