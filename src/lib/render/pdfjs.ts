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

const BASE = import.meta.env.BASE_URL

/**
 * Open a PDF with PDF.js. `data` is copied because PDF.js transfers (detaches) the buffer it receives.
 * `forExport` renders on this thread so canvases stay readable with toBlob().
 */
export async function openPdf(data: Uint8Array, opts: { password?: string; name?: string; forExport?: boolean } = {}): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    data: data.slice(),
    password: opts.password,
    cMapUrl: `${BASE}pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${BASE}pdfjs/standard_fonts/`,
    wasmUrl: `${BASE}pdfjs/wasm/`,
    iccUrl: `${BASE}pdfjs/iccs/`,
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
    throw new UserFacingError(`“${opts.name ?? 'This file'}” couldn't be opened. It may be damaged or not a real PDF.`)
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

export function canvasToBlob(canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The page image could not be encoded.'))), type, quality),
  )
}

/** Free canvas memory immediately (important on mobile Safari). */
export function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0
  canvas.height = 0
}
