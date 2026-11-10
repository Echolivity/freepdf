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
