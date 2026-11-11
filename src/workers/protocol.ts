import type { NamedBytes } from '../lib/pdf/core'
import type { ArrangeOp, PageOp } from '../lib/pdf/organize'
import type { PageNumberOptions, WatermarkOptions } from '../lib/pdf/stamp'
import type { CropPage } from '../lib/pdf/crop'
import type { CompressionLevel, CompressResult } from '../lib/pdf/compress'
import type { ImagesToPdfOptions } from '../lib/pdf/images'
import type { Message } from '../i18n/core'
import type { ResizeOptions } from '../lib/pdf/resizePlan'
import type { DiffRun } from '../lib/compare/diff'

export interface RawImage {
  name: string
  bytes: Uint8Array
  kind: 'jpeg' | 'png' | 'webp'
}

/** Every operation the PDF worker can run: [arguments, result]. */
export interface WorkerOps {
  merge: [{ files: NamedBytes[] }, Uint8Array]
  split: [{ file: NamedBytes; groups: number[][] }, Uint8Array[]]
  extract: [{ file: NamedBytes; indices: number[] }, Uint8Array]
  remove: [{ file: NamedBytes; indices: number[] }, Uint8Array]
  rotate: [{ file: NamedBytes; angle: number; indices: number[] | null }, Uint8Array]
  organize: [{ file: NamedBytes; ops: PageOp[] }, Uint8Array]
  compress: [{ file: NamedBytes; level: CompressionLevel }, CompressResult]
  imagesToPdf: [{ images: RawImage[]; options: ImagesToPdfOptions }, Uint8Array]
  pageCount: [{ file: NamedBytes }, number]
  arrange: [{ file: NamedBytes; inserts: NamedBytes[]; ops: ArrangeOp[] }, Uint8Array]
  pageNumbers: [{ file: NamedBytes; options: PageNumberOptions }, Uint8Array]
  watermark: [{ file: NamedBytes; options: WatermarkOptions }, Uint8Array]
  crop: [{ file: NamedBytes; pages: CropPage[] }, Uint8Array]
  resize: [{ file: NamedBytes; options: ResizeOptions }, Uint8Array]
  diffTokens: [{ a: Int32Array; b: Int32Array }, DiffRun[]]
}

export type OpName = keyof WorkerOps

export type WorkerRequest = { [K in OpName]: { id: number; op: K; args: WorkerOps[K][0] } }[OpName]

export type WorkerResponse =
  | { id: number; type: 'progress'; value: number; label?: Message }
  | { id: number; type: 'done'; result: unknown }
  | { id: number; type: 'error'; error: Message; userFacing: boolean }
