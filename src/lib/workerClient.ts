import type { OpName, WorkerOps, WorkerResponse } from '../workers/protocol'
import { UserFacingError } from './validate'
import type { Message } from '../i18n/core'
import { transferablesOf } from './transfer'

export class CancelledError extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'CancelledError'
  }
}

/**
 * Run one operation in a fresh Web Worker. A worker per job keeps the UI responsive, lets the user
 * cancel instantly (the worker is terminated), and guarantees no document data lingers in a
 * long-lived worker after the job finishes.
 */
export function runInWorker<K extends OpName>(
  op: K,
  args: WorkerOps[K][0],
  opts: { onProgress?: (value: number, label?: Message) => void; signal?: AbortSignal } = {},
): Promise<WorkerOps[K][1]> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new CancelledError())
    const worker = new Worker(new URL('../workers/pdf.worker.ts', import.meta.url), { type: 'module' })
    const id = 1
    const cleanup = () => {
      worker.terminate()
      opts.signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(new CancelledError())
    }
    opts.signal?.addEventListener('abort', onAbort)
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data
      if (msg.id !== id) return
      if (msg.type === 'progress') opts.onProgress?.(msg.value, msg.label)
      else if (msg.type === 'done') {
        cleanup()
        resolve(msg.result as WorkerOps[K][1])
      } else {
        cleanup()
        reject(new UserFacingError(msg.error.key, msg.error.params))
      }
    }
    worker.onerror = () => {
      cleanup()
      reject(new UserFacingError('err.worker'))
    }
    // Move (transfer) the input bytes instead of copying them: halves peak memory for large files.
    // Callers always pass freshly read bytes and never reuse them; a retry re-reads the File.
    worker.postMessage({ id, op, args }, transferablesOf(args))
  })
}
