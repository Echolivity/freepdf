import { uniqueNames } from './files'

export interface OutputFile {
  name: string
  blob: Blob
  /** Optional one-line note shown under the file (e.g. size saved). */
  note?: string
}

export function pdfBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
}

/** Trigger a browser download for a Blob. The temporary URL is revoked right after. */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser time to start the download before releasing memory.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** Bundle outputs into a ZIP. JSZip is loaded only when needed. Already-compressed formats are stored, not re-deflated. */
export async function zipOutputs(files: OutputFile[], onProgress?: (v: number) => void): Promise<Blob> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const names = uniqueNames(files.map((f) => f.name))
  files.forEach((f, i) => zip.file(names[i], f.blob, { binary: true }))
  return zip.generateAsync({ type: 'blob', compression: 'STORE', mimeType: 'application/zip' }, (m) => onProgress?.(m.percent / 100))
}

export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr
  const copy = arr.slice()
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item)
  return copy
}
