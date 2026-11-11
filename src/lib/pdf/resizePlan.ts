import { UserFacingError } from '../validate'

// Page-size planning for Resize PDF. No pdf-lib here, so the tool's UI can preview without loading it.

const normalizeAngle = (a: number) => ((Math.round(a / 90) * 90) % 360 + 360) % 360

/** Common paper sizes in PDF points (1 pt = 1/72 inch), portrait. */
export const PAPER = {
  a3: [841.89, 1190.55],
  a4: [595.28, 841.89],
  a5: [419.53, 595.28],
  letter: [612, 792],
  legal: [612, 1008],
} as const satisfies Record<string, readonly [number, number]>
export type PaperName = keyof typeof PAPER

/**
 * - fit: scale content uniformly so the whole page fits inside the margins, centred.
 * - fitWidth: scale so the page width fits inside the margins, centred vertically (tall pages are cut).
 * - canvas: no scaling; change the page size around the content, centred (pads or trims the edges).
 */
export type ResizeMode = 'fit' | 'fitWidth' | 'canvas'
export type Orientation = 'auto' | 'portrait' | 'landscape'

export interface ResizeOptions {
  /** Target size in points as the reader sees it, before orientation is applied. */
  width: number
  height: number
  orientation: Orientation
  mode: ResizeMode
  /** Margin in points on every side (fit modes only). */
  margin: number
  /** 0-based pages to resize; null = all. */
  indices: number[] | null
}

export type Matrix = [number, number, number, number, number, number]

/** Where a page's content goes on the new page. Pure geometry, exported for tests and the preview. */
export function planPage(
  box: { x: number; y: number; width: number; height: number },
  rotation: number,
  o: Pick<ResizeOptions, 'width' | 'height' | 'orientation' | 'mode' | 'margin'>,
): { width: number; height: number; matrix: Matrix; scale: number } {
  const quarter = normalizeAngle(rotation) % 180 !== 0
  // Visual (as displayed) size of the current page and of the target.
  const vw = quarter ? box.height : box.width
  const vh = quarter ? box.width : box.height
  let tw = o.width
  let th = o.height
  const wantLandscape = o.orientation === 'landscape' || (o.orientation === 'auto' && vw > vh)
  if (o.orientation !== 'auto' || vw !== vh) if (wantLandscape !== tw > th) [tw, th] = [th, tw]
  const m = o.mode === 'canvas' ? 0 : Math.max(0, o.margin)
  const s = o.mode === 'canvas' ? 1 : o.mode === 'fitWidth' ? (tw - 2 * m) / vw : Math.min((tw - 2 * m) / vw, (th - 2 * m) / vh)
  if (!(s > 0) || !Number.isFinite(s)) throw new UserFacingError('err.resizeMargin')
  // Unrotated page space: the page keeps its /Rotate, so its boxes are stored unrotated.
  const width = quarter ? th : tw
  const height = quarter ? tw : th
  const tx = (width - s * box.width) / 2 - s * box.x
  const ty = (height - s * box.height) / 2 - s * box.y
  return { width, height, matrix: [s, 0, 0, s, tx, ty], scale: s }
}

