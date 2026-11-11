import { UserFacingError } from '../validate'
import { msg } from '../../i18n/core'
import { loadPdf, saveDoc, noProgress, type NamedBytes, type ProgressFn } from './core'
import { insetVisual, visualSize } from './geometry'

/** How much to cut from each side of a page, in points, as the reader sees it. */
export interface CropInsets {
  top: number
  right: number
  bottom: number
  left: number
}
export interface CropPage {
  /** 0-based page index. */
  index: number
  inset: CropInsets
}

/** The smallest page left after cropping (½ inch). */
export const MIN_SIDE = 36

export const isZero = (i: CropInsets) => !i.top && !i.right && !i.bottom && !i.left

/**
 * Crop pages by setting their CropBox. This only changes what viewers and printers show: the content
 * outside the new box is hidden, not deleted, and anyone can restore it. Removing confidential content
 * needs redaction, not cropping. Text, links, form fields and everything else are untouched.
 */
export async function cropPdf(input: NamedBytes, pages: CropPage[], onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  const work = pages.filter((p) => !isZero(p.inset))
  if (!work.length) throw new UserFacingError('err.cropNothing')
  const doc = await loadPdf(input.bytes, input.name)
  const all = doc.getPages()
  for (let k = 0; k < work.length; k++) {
    const { index, inset } = work[k]
    if (!Number.isInteger(index) || index < 0 || index >= all.length) throw new UserFacingError('err.pageMissing', { page: index + 1, count: all.length })
    if ([inset.top, inset.right, inset.bottom, inset.left].some((v) => !Number.isFinite(v) || v < 0)) throw new UserFacingError('err.cropInvalid')
    if (k % 50 === 0) onProgress(k / work.length, msg('prog.page', { i: k + 1, n: work.length }))
    const page = all[index]
    const box = page.getCropBox()
    const rot = page.getRotation().angle
    const vs = visualSize(box, rot)
    if (vs.width - inset.left - inset.right < MIN_SIDE || vs.height - inset.top - inset.bottom < MIN_SIDE) {
      throw new UserFacingError('err.cropTooSmall', { page: index + 1 })
    }
    const nb = insetVisual(box, rot, inset)
    page.setCropBox(nb.x, nb.y, nb.width, nb.height)
  }
  onProgress(1)
  return saveDoc(doc)
}
