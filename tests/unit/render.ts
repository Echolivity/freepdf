import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const require = createRequire(import.meta.url)
const root = dirname(require.resolve('pdfjs-dist/package.json'))
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(root, 'legacy/build/pdf.worker.mjs')).href

export interface Raster { width: number; height: number; data: Uint8ClampedArray }

/** Render one page (1-based) with PDF.js in Node, on a white background. */
export async function renderPage(bytes: Uint8Array, pageNumber: number, scale = 1): Promise<Raster> {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    standardFontDataUrl: join(root, 'standard_fonts') + '/',
    cMapUrl: join(root, 'cmaps') + '/',
    cMapPacked: true,
    disableWorkerRendering: true,
  } as Parameters<typeof pdfjs.getDocument>[0])
  const doc = await task.promise
  try {
    const page = await doc.getPage(pageNumber)
    const viewport = page.getViewport({ scale })
    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height))
    const ctx = canvas.getContext('2d')
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, background: '#ffffff' }).promise
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return { width: canvas.width, height: canvas.height, data: img.data as unknown as Uint8ClampedArray }
  } finally {
    await task.destroy()
  }
}

/** Mean absolute difference per channel (0–255) between two rasters of equal size. */
export function meanDiff(a: Raster, b: Raster): number {
  if (a.width !== b.width || a.height !== b.height) return Infinity
  let sum = 0
  for (let i = 0; i < a.data.length; i += 4) {
    sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
  }
  return sum / ((a.data.length / 4) * 3)
}

/** Open a PDF with PDF.js in Node (caller must call `close()`). For text extraction and page geometry. */
export async function openNode(bytes: Uint8Array) {
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: join(root, 'standard_fonts') + '/',
    cMapUrl: join(root, 'cmaps') + '/',
    cMapPacked: true,
  } as Parameters<typeof pdfjs.getDocument>[0])
  const doc = await task.promise
  return { doc, close: () => task.destroy() }
}

/** Visible size of every page (rotation applied), in points. */
export async function visualSizes(bytes: Uint8Array): Promise<[number, number][]> {
  const { doc, close } = await openNode(bytes)
  try {
    const out: [number, number][] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const vp = (await doc.getPage(i)).getViewport({ scale: 1 })
      out.push([Math.round(vp.width * 100) / 100, Math.round(vp.height * 100) / 100])
    }
    return out
  } finally {
    await close()
  }
}

/** Text of every page (items joined by spaces, whitespace collapsed). */
export async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const { doc, close } = await openNode(bytes)
  try {
    const out: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const c = await (await doc.getPage(i)).getTextContent()
      out.push(c.items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' ').trim())
    }
    return out
  } finally {
    await close()
  }
}
