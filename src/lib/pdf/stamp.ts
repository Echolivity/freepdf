import { PDFArray, degrees, type PDFImage, type PDFPage } from 'pdf-lib'
import { UserFacingError } from '../validate'
import { msg } from '../../i18n/core'
import { loadPdf, saveDoc, noProgress, type NamedBytes, type ProgressFn } from './core'
import { fontFor, type FontFamily } from './fonts'
import { visualSize, visualToUser, type Box } from './geometry'
import { drawLine, parseColor, textWidth } from './text'
import { pageLabels, type NumberStyle } from './labels'
export { formatNumber, pageLabels, type NumberStyle } from './labels'

/**
 * Page numbers and watermarks. Both are drawn as a new, self-contained content stream on each page
 * (`q … Q`), so the original page content is never rewritten: text stays text, images keep their
 * bytes, and the stamp is real vector text that can be selected and searched.
 */

export interface PageNumberOptions {
  vertical: 'top' | 'bottom'
  align: 'left' | 'center' | 'right'
  /** Distance from the page edges, in points. */
  margin: number
  start: number
  style: NumberStyle
  prefix: string
  suffix: string
  font: FontFamily
  bold: boolean
  size: number
  color: string
  /** 0-based pages to number; null = all. */
  indices: number[] | null
  /** Leave the first page (cover) unnumbered; numbering starts on the next numbered page. */
  skipFirst: boolean
}

function checkIndices(indices: number[] | null, count: number) {
  for (const i of indices ?? []) if (!Number.isInteger(i) || i < 0 || i >= count) throw new UserFacingError('err.pageMissing', { page: i + 1, count })
}

const visibleBox = (page: PDFPage): Box => page.getCropBox()

export async function addPageNumbers(input: NamedBytes, o: PageNumberOptions, onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  if (!(o.size >= 4 && o.size <= 200)) throw new UserFacingError('err.stampSize')
  if (!Number.isInteger(o.start) || o.start < 0 || o.start > 1_000_000) throw new UserFacingError('err.stampStart')
  const doc = await loadPdf(input.bytes, input.name)
  const pages = doc.getPages()
  checkIndices(o.indices, pages.length)
  const labels = pageLabels(pages.length, o)
  if (!labels.some(Boolean)) throw new UserFacingError('err.stampNoPages')
  const font = await fontFor(doc, o.font, o.bold, labels.filter((l): l is string => !!l))
  const color = parseColor(o.color)
  const ascent = font.heightAtSize(o.size, { descender: false })
  for (let i = 0; i < pages.length; i++) {
    if (i % 50 === 0) onProgress(i / pages.length, msg('prog.page', { i: i + 1, n: pages.length }))
    const label = labels[i]
    if (!label) continue
    const page = pages[i]
    const box = visibleBox(page)
    const rot = page.getRotation().angle
    const { width: W, height: H } = visualSize(box, rot)
    const w = textWidth(font, label, o.size)
    const m = Math.min(o.margin, W / 3, H / 3)
    const vx = o.align === 'left' ? m : o.align === 'right' ? W - m - w : (W - w) / 2
    const vy = o.vertical === 'bottom' ? m : H - m - ascent
    const p = visualToUser(box, rot, vx, vy)
    drawLine(page, label, { font, size: o.size, x: p.x, y: p.y, angle: p.angle, color })
  }
  onProgress(1)
  return saveDoc(doc)
}

export type Anchor = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br'
export interface WatermarkOptions {
  kind: 'text' | 'image'
  text: string
  font: FontFamily
  bold: boolean
  size: number
  color: string
  image: { bytes: Uint8Array; kind: 'png' | 'jpeg' } | null
  /** Image width as a share of the page width (0.02–1). */
  imageScale: number
  anchor: Anchor
  /** Degrees, counter-clockwise as the reader sees the page. */
  rotation: number
  opacity: number
  tiled: boolean
  /** Space between tiles, in points. */
  gap: number
  layer: 'over' | 'under'
  indices: number[] | null
}

const MARGIN = 36

/** Move the stream pdf-lib just appended to the front, so the stamp is painted before (under) the page. */
function sendToBack(page: PDFPage) {
  const contents = page.node.Contents()
  if (!(contents instanceof PDFArray) || contents.size() < 2) return
  const last = contents.get(contents.size() - 1)
  contents.remove(contents.size() - 1)
  contents.insert(0, last)
}

export async function addWatermark(input: NamedBytes, o: WatermarkOptions, onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  if (!(o.opacity > 0 && o.opacity <= 1)) throw new UserFacingError('err.stampOpacity')
  if (o.kind === 'text' && !o.text.trim()) throw new UserFacingError('err.stampText')
  if (o.kind === 'text' && !(o.size >= 4 && o.size <= 400)) throw new UserFacingError('err.stampSize')
  if (o.kind === 'image' && !o.image) throw new UserFacingError('err.stampImage')
  const doc = await loadPdf(input.bytes, input.name)
  const pages = doc.getPages()
  checkIndices(o.indices, pages.length)
  const targets = o.indices ?? pages.map((_, i) => i)
  if (!targets.length) throw new UserFacingError('err.stampNoPages')

  const text = o.text.replace(/\s+/g, ' ').trim()
  const font = o.kind === 'text' ? await fontFor(doc, o.font, o.bold, [text]) : null
  let image: PDFImage | null = null
  if (o.kind === 'image' && o.image) {
    try {
      image = o.image.kind === 'png' ? await doc.embedPng(o.image.bytes) : await doc.embedJpg(o.image.bytes)
    } catch {
      throw new UserFacingError('err.stampImage')
    }
  }
  const color = parseColor(o.color)
  const theta = (o.rotation * Math.PI) / 180

  for (let k = 0; k < targets.length; k++) {
    if (k % 50 === 0) onProgress(k / targets.length, msg('prog.page', { i: k + 1, n: targets.length }))
    const page = pages[targets[k]]
    const box = visibleBox(page)
    const rot = page.getRotation().angle
    const { width: W, height: H } = visualSize(box, rot)
    // Element size (unrotated), in visual units.
    let w: number
    let h: number
    if (font) {
      w = textWidth(font, text, o.size)
      h = font.heightAtSize(o.size, { descender: false })
    } else {
      w = W * Math.min(1, Math.max(0.02, o.imageScale))
      h = (w * image!.height) / image!.width
    }
    const bw = Math.abs(w * Math.cos(theta)) + Math.abs(h * Math.sin(theta))
    const bh = Math.abs(w * Math.sin(theta)) + Math.abs(h * Math.cos(theta))
    const centres: [number, number][] = []
    if (o.tiled) {
      const sx = bw + Math.max(0, o.gap)
      const sy = bh + Math.max(0, o.gap)
      // Cover the page from the centre outwards so the pattern is symmetric.
      const nx = Math.ceil(W / sx / 2) + 1
      const ny = Math.ceil(H / sy / 2) + 1
      for (let iy = -ny; iy <= ny; iy++) for (let ix = -nx; ix <= nx; ix++) {
        const cx = W / 2 + ix * sx + (iy % 2 ? sx / 2 : 0)
        const cy = H / 2 + iy * sy
        if (cx + bw / 2 > 0 && cx - bw / 2 < W && cy + bh / 2 > 0 && cy - bh / 2 < H) centres.push([cx, cy])
      }
    } else {
      const col = o.anchor[1]
      const row = o.anchor[0]
      const cx = col === 'l' ? MARGIN + bw / 2 : col === 'r' ? W - MARGIN - bw / 2 : W / 2
      const cy = row === 'b' ? MARGIN + bh / 2 : row === 't' ? H - MARGIN - bh / 2 : H / 2
      centres.push([cx, cy])
    }
    for (const [cx, cy] of centres) {
      // Bottom-left of the element, rotated about its centre.
      const ox = cx + (-w / 2) * Math.cos(theta) - (-h / 2) * Math.sin(theta)
      const oy = cy + (-w / 2) * Math.sin(theta) + (-h / 2) * Math.cos(theta)
      const p = visualToUser(box, rot, ox, oy)
      const angle = p.angle + o.rotation
      if (font) drawLine(page, text, { font, size: o.size, x: p.x, y: p.y, angle, color, opacity: o.opacity })
      else page.drawImage(image!, { x: p.x, y: p.y, width: w, height: h, rotate: degrees(angle), opacity: o.opacity })
    }
    if (o.layer === 'under') sendToBack(page)
  }
  onProgress(1)
  return saveDoc(doc)
}
