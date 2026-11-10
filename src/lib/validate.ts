import { LIMITS, MB } from '../config'

export type FileKind = 'pdf' | 'jpeg' | 'png' | 'webp'

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserFacingError'
  }
}

/** Identify a file from its leading bytes. Extensions and MIME types are not trusted. */
export function sniffKind(head: Uint8Array): FileKind | null {
  const b = head
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  )
    return 'png'
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  )
    return 'webp'
  // The PDF spec allows junk before the header; readers accept it within the first 1 KB.
  const limit = Math.min(b.length - 5, 1024)
  for (let i = 0; i <= limit; i++) {
    if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2d) return 'pdf'
  }
  return null
}

/** Read image dimensions from the header without decoding pixels. */
export function imageDimensions(bytes: Uint8Array, kind: FileKind): { width: number; height: number } | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (kind === 'png') {
    if (bytes.length < 24) return null
    return { width: dv.getUint32(16), height: dv.getUint32(20) }
  }
  if (kind === 'jpeg') {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue }
      const marker = bytes[i + 1]
      if (marker === 0xff) { i++; continue }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
      const len = dv.getUint16(i + 2)
      // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) }
      }
      i += 2 + len
    }
    return null
  }
  if (kind === 'webp') {
    if (bytes.length < 30) return null
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
    if (chunk === 'VP8X') return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) }
    if (chunk === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff }
    if (chunk === 'VP8L') {
      const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24]
      return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) }
    }
  }
  return null
}

export interface ValidatedFile {
  id: string
  file: File
  name: string
  kind: FileKind
  size: number
}

const KIND_LABEL: Record<FileKind, string> = { pdf: 'PDF', jpeg: 'JPG', png: 'PNG', webp: 'WebP' }

let counter = 0
const newId = () => `f${Date.now().toString(36)}${(counter++).toString(36)}`

/**
 * Validate a batch of user-selected files. Returns accepted files and human-readable rejections.
 */
export async function validateFiles(
  files: File[],
  accept: FileKind[],
  existingBytes = 0,
  existingCount = 0,
): Promise<{ accepted: ValidatedFile[]; rejected: string[] }> {
  const accepted: ValidatedFile[] = []
  const rejected: string[] = []
  let total = existingBytes
  const expected = accept.map((k) => KIND_LABEL[k]).join(' or ')

  for (const file of files) {
    if (existingCount + accepted.length >= LIMITS.maxFiles) {
      rejected.push(`Only ${LIMITS.maxFiles} files can be processed at once; the rest were skipped.`)
      break
    }
    if (file.size === 0) { rejected.push(`“${file.name}” is empty.`); continue }
    if (file.size > LIMITS.maxFileBytes) {
      rejected.push(`“${file.name}” is ${Math.round(file.size / MB)} MB. The limit per file is ${LIMITS.maxFileBytes / MB} MB so your browser doesn't run out of memory.`)
      continue
    }
    if (total + file.size > LIMITS.maxJobBytes) {
      rejected.push(`“${file.name}” would take this job over ${LIMITS.maxJobBytes / MB} MB in total. Process it in a separate batch.`)
      continue
    }
    const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer())
    const kind = sniffKind(head)
    if (!kind || !accept.includes(kind)) {
      rejected.push(`“${file.name}” isn't a ${expected} file${kind ? ` (it looks like ${KIND_LABEL[kind]})` : ''}.`)
      continue
    }
    if (kind !== 'pdf') {
      const dims = imageDimensions(head, kind)
      if (dims && dims.width * dims.height > LIMITS.maxImagePixels) {
        rejected.push(`“${file.name}” is ${dims.width}×${dims.height} pixels, which is too large to process safely.`)
        continue
      }
    }
    total += file.size
    accepted.push({ id: newId(), file, name: file.name, kind, size: file.size })
  }
  return { accepted, rejected }
}
