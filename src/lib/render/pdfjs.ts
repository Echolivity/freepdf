import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import rendererSrc from 'pdfjs-dist/build/pdf.renderer.min.mjs?url'
import { LIMITS } from '../../config'
import { UserFacingError } from '../validate'

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
pdfjs.GlobalWorkerOptions.rendererSrc = rendererSrc

export type { PDFDocumentProxy }

export class PasswordRequiredError extends Error {
  incorrect: boolean
  constructor(incorrect: boolean) {
    super(incorrect ? 'Incorrect password' : 'Password required')
    this.name = 'PasswordRequiredError'
    this.incorrect = incorrect
  }
}

const tasks = new WeakMap<PDFDocumentProxy, { destroy(): Promise<void> }>()

/** Tear down a document and its PDF.js worker, releasing all memory it holds. */
export async function closePdf(doc: PDFDocumentProxy | null | undefined) {
  if (!doc) return
  const task = tasks.get(doc)
  tasks.delete(doc)
  try { await task?.destroy() } catch { /* already gone */ }
}

// Versioned path (see scripts/copy-pdfjs-assets.mjs) so these files can be cached as immutable.
const BASE = `${import.meta.env.BASE_URL}pdfjs/${pdfjs.version}/`

/**
 * Open a PDF with PDF.js. Takes ownership of `data`: PDF.js transfers (detaches) the buffer, so callers
 * pass freshly read bytes and don't reuse them (no extra copy of large files).
 * `forExport` renders on this thread so canvases stay readable with toBlob().
 */
export async function openPdf(data: Uint8Array, opts: { password?: string; name?: string; forExport?: boolean } = {}): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    data,
    password: opts.password,
    cMapUrl: `${BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${BASE}standard_fonts/`,
    wasmUrl: `${BASE}wasm/`,
    iccUrl: `${BASE}iccs/`,
    enableXfa: false,
    stopAtErrors: false,
    disableWorkerRendering: !!opts.forExport,
  })
  try {
    const doc = await task.promise
    tasks.set(doc, task)
    return doc
  } catch (err) {
    task.destroy().catch(() => {})
    const e = err as { name?: string; code?: number; message?: string }
    if (e?.name === 'PasswordException') throw new PasswordRequiredError(e.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD)
    throw new UserFacingError('err.cantOpen', { name: opts.name ?? 'PDF' })
  }
}

/** Largest scale at which a page fits within browser canvas limits. */
export function safeScale(width: number, height: number, desired: number): number {
  let s = desired
  if (width * s > LIMITS.maxCanvasSide) s = LIMITS.maxCanvasSide / width
  if (height * s > LIMITS.maxCanvasSide) s = LIMITS.maxCanvasSide / height
  if (width * s * height * s > LIMITS.maxCanvasPixels) s = Math.sqrt(LIMITS.maxCanvasPixels / (width * height))
  return s
}

/** Render one page (1-based) to a new canvas. White background so JPEGs don't turn black. */
export async function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  extraRotation = 0,
): Promise<{ canvas: HTMLCanvasElement; scaleUsed: number }> {
  const page = await doc.getPage(pageNumber)
  try {
    const rotation = (page.rotate + extraRotation) % 360
    const base = page.getViewport({ scale: 1, rotation })
    const s = safeScale(base.width, base.height, scale)
    const viewport = page.getViewport({ scale: s, rotation })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))
    await page.render({ canvas, viewport, background: '#ffffff' }).promise
    return { canvas, scaleUsed: s }
  } finally {
    page.cleanup()
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/png' | 'image/webp', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => {
      // Browsers that can't encode a type silently return PNG instead: never label that as WebP.
      if (!b) reject(new Error('The page image could not be encoded.'))
      else if (b.type !== type) reject(new Error(`This browser cannot encode ${type}.`))
      else resolve(b)
    }, type, quality),
  )
}

/** Whether this browser's canvas can encode WebP (Chrome, Edge and Firefox can; Safari can't). */
export function canEncodeWebp(): boolean {
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    return c.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    return false
  }
}

/** Free canvas memory immediately (important on mobile Safari). */
export function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0
  canvas.height = 0
}

/** PDF.js operator codes (for reading where images are painted). */
export function pdfjsOps(): Record<string, number> {
  return pdfjs.OPS as unknown as Record<string, number>
}
