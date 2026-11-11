/// <reference lib="webworker" />
import { mergePdfs, splitPdf, extractPages, removePages, rotatePdf, organizePdf, getPageCount } from '../lib/pdf/organize'
import { compressPdf } from '../lib/pdf/compress'
import { resizePdf } from '../lib/pdf/resize'
import { diffTokens } from '../lib/compare/diff'
import { imagesToPdf, type ImageInput } from '../lib/pdf/images'
import { UserFacingError } from '../lib/validate'
import { canvasCodec, toPng } from './codec'
import type { WorkerRequest, WorkerResponse } from './protocol'
import type { Message } from '../i18n/core'
import { transferablesOf } from '../lib/transfer'

declare const self: DedicatedWorkerGlobalScope

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer)
}


self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  const progress = (value: number, label?: Message) => post({ id: req.id, type: 'progress', value, label })
  try {
    let result: unknown
    switch (req.op) {
      case 'merge': result = await mergePdfs(req.args.files, progress); break
      case 'split': result = await splitPdf(req.args.file, req.args.groups, progress); break
      case 'extract': result = await extractPages(req.args.file, req.args.indices); break
      case 'remove': result = await removePages(req.args.file, req.args.indices); break
      case 'rotate': result = await rotatePdf(req.args.file, req.args.angle, req.args.indices); break
      case 'organize': result = await organizePdf(req.args.file, req.args.ops); break
      case 'compress': result = await compressPdf(req.args.file, req.args.level, canvasCodec, progress); break
      case 'pageCount': result = await getPageCount(req.args.file); break
      case 'resize': result = await resizePdf(req.args.file, req.args.options, progress); break
      case 'diffTokens': result = diffTokens(req.args.a, req.args.b); break
      case 'imagesToPdf': {
        const images: ImageInput[] = []
        for (const img of req.args.images) {
          if (img.kind === 'webp') {
            try {
              images.push({ name: img.name, kind: 'png', bytes: await toPng(img.bytes, 'image/webp') })
            } catch {
              throw new UserFacingError('err.imageDecode', { name: img.name })
            }
          } else images.push({ name: img.name, kind: img.kind, bytes: img.bytes })
        }
        result = await imagesToPdf(images, req.args.options, progress)
        break
      }
    }
    // Never transfer the caller's original input back (e.g. compress returning the original bytes is fine to copy).
    post({ id: req.id, type: 'done', result }, transferablesOf(result))
  } catch (err) {
    const userFacing = err instanceof UserFacingError
    post({
      id: req.id,
      type: 'error',
      userFacing,
      error: userFacing ? (err as UserFacingError).toMessage() : { key: 'err.processing', params: { detail: (err as Error)?.message ?? String(err) } },
    })
  }
}
