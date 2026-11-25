/**
 * In-browser OCR with tesseract.js (Apache-2.0), served from our own origin: the worker script, the
 * WebAssembly engine and the language models live under /ocr/<version>/ (scripts/copy-ocr-assets.mjs).
 * Nothing is fetched from elsewhere and nothing is cached in browser storage (cacheMethod 'none'); the
 * files are HTTP-cached like any other static asset. Loaded only when someone runs OCR.
 */
import { wordsFromBlocks, type OcrResult } from './pageText'

/** Must match the installed tesseract.js version (checked by a unit test). */
export const OCR_VERSION = '7.0.0'

export type OcrLang = 'eng' | 'ara'

/** What the engine is doing, for progress messages. */
export type OcrStage = 'engine' | 'language' | 'recognising'

export interface Ocr {
  recognise(image: HTMLCanvasElement | OffscreenCanvas | Blob): Promise<OcrResult>
  /** Stops any recognition in progress and frees the worker. */
  terminate(): Promise<void>
}

export async function createOcr(langs: OcrLang[], onStage?: (stage: OcrStage, progress: number) => void): Promise<Ocr> {
  const { createWorker, OEM, PSM } = await import('tesseract.js')
  const base = `${(import.meta.env?.BASE_URL as string | undefined) ?? '/'}ocr/${OCR_VERSION}`
  let recognising = false
  const worker = await createWorker(langs, OEM.LSTM_ONLY, {
    workerPath: `${base}/worker.min.js`,
    corePath: `${base}/core`,
    langPath: `${base}/lang`,
    gzip: true,
    cacheMethod: 'none',
    workerBlobURL: false,
    logger: (m) => {
      const p = typeof m.progress === 'number' ? m.progress : 0
      if (/core/i.test(m.status)) onStage?.('engine', p)
      else if (/language|traineddata/i.test(m.status)) onStage?.('language', p)
      else if (recognising && /recogni/i.test(m.status)) onStage?.('recognising', p)
    },
  })
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' })
  return {
    async recognise(image) {
      recognising = true
      try {
        const size = 'width' in image ? { width: image.width, height: image.height } : await imageSize(image)
        const { data } = await worker.recognize(image as HTMLCanvasElement, {}, { blocks: true, text: false })
        return wordsFromBlocks(data.blocks as never, size.width, size.height)
      } finally {
        recognising = false
      }
    },
    async terminate() {
      await worker.terminate()
    },
  }
}

async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(blob)
  const out = { width: bmp.width, height: bmp.height }
  bmp.close()
  return out
}
