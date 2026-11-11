import { LIMITS, MB } from '../config'
import { msg, translate, type Message, type MessageKey, type Params } from '../i18n/core'
import { scanPdfMarkers } from './inspect'

export type FileKind = 'pdf' | 'jpeg' | 'png' | 'webp' | 'tiff' | 'text' | 'docx' | 'xlsx' | 'html'

/** An error meant for the person using the app. Carries a message key so it can be shown in any language. */
export class UserFacingError extends Error {
  key: MessageKey
  params?: Params
  constructor(key: MessageKey, params?: Params) {
    super(translate('en', key, params))
    this.name = 'UserFacingError'
    this.key = key
    this.params = params
  }
  toMessage(): Message {
    return { key: this.key, params: this.params }
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
  // Classic TIFF, little-endian "II*\0" or big-endian "MM\0*". (BigTIFF, 43, isn't supported.)
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)))
    return 'tiff'
  // The PDF spec allows junk before the header; readers accept it within the first 1 KB.
  const limit = Math.min(b.length - 5, 1024)
  for (let i = 0; i <= limit; i++) {
    if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2d) return 'pdf'
  }
  return null
}

/**
 * Plain text has no signature, so it is recognised by name (.txt) and content: a UTF-16 byte-order
 * mark, or no NUL bytes and almost no control characters in the first 64 KB.
 */
export function looksLikeText(head: Uint8Array, name: string): boolean {
  if (!/\.(txt|text)$/i.test(name)) return false
  if (head.length >= 2 && ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))) return true
  let control = 0
  for (const c of head) {
    if (c === 0) return false
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d && c !== 0x0c && c !== 0x1b) control++
  }
  return control <= head.length * 0.01
}

/**
 * Office Open XML files are ZIP archives: the name says which (the archive itself is checked when it
 * is opened). HTML is text that looks like markup.
 */
export function sniffByName(head: Uint8Array, name: string): FileKind | null {
  const zip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
  if (zip && /\.docx$/i.test(name)) return 'docx'
  if (zip && /\.xlsx$/i.test(name)) return 'xlsx'
  if (/\.x?html?$/i.test(name) && looksLikeText(head, 'x.txt')) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(head.subarray(0, 4096))
    if (/<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]|<(p|div|h[1-6]|table|ul|ol|span|br)[\s>/]/i.test(text)) return 'html'
  }
  return null
}

/** Old binary Office files (.doc/.xls/.ppt) and password-protected Office files share this container. */
export function isLegacyOffice(head: Uint8Array): boolean {
  return head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0
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

/**
 * Walk JPEG marker segments through the whole file (reading only each segment header), for files whose
 * metadata (EXIF, ICC, thumbnails) pushes the frame header past the first bytes we sniffed.
 */
export async function jpegDimensionsFromFile(file: Blob): Promise<{ width: number; height: number } | null> {
  let i = 2
  for (let guard = 0; guard < 10_000 && i + 9 < file.size; guard++) {
    const h = new Uint8Array(await file.slice(i, i + 10).arrayBuffer())
    if (h[0] !== 0xff) return null
    const m = h[1]
    if (m === 0xff) { i++; continue }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue }
    if (m === 0xd9 || m === 0xda) return null // end of image / start of scan before any frame header
    const len = (h[2] << 8) | h[3]
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: (h[5] << 8) | h[6], width: (h[7] << 8) | h[8] }
    }
    if (len < 2) return null
    i += 2 + len
  }
  return null
}

export interface ValidatedFile {
  id: string
  file: File
  name: string
  kind: FileKind
  size: number
  /** PDF only: contains a digital signature (editing invalidates it). */
  signed?: boolean
  /** PDF only: certified by its author (no changes permitted). */
  certified?: boolean
  /** PDF only: password/permission protected. */
  encrypted?: boolean
}

const KIND_LABEL: Record<FileKind, string> = { pdf: 'PDF', jpeg: 'JPG', png: 'PNG', webp: 'WebP', tiff: 'TIFF', text: 'TXT', docx: 'DOCX', xlsx: 'XLSX', html: 'HTML' }

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
): Promise<{ accepted: ValidatedFile[]; rejected: Message[] }> {
  const accepted: ValidatedFile[] = []
  const rejected: Message[] = []
  let total = existingBytes
  const expected = accept.map((k) => KIND_LABEL[k]).join('/')

  for (const file of files) {
    if (existingCount + accepted.length >= LIMITS.maxFiles) {
      rejected.push(msg('val.tooMany', { max: LIMITS.maxFiles }))
      break
    }
    if (file.size === 0) { rejected.push(msg('val.empty', { name: file.name })); continue }
    if (file.size > LIMITS.maxFileBytes) {
      rejected.push(msg('val.fileTooBig', { name: file.name, size: Math.round(file.size / MB), limit: LIMITS.maxFileBytes / MB }))
      continue
    }
    if (total + file.size > LIMITS.maxJobBytes) {
      rejected.push(msg('val.jobTooBig', { name: file.name, limit: LIMITS.maxJobBytes / MB }))
      continue
    }
    const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer())
    const kind = sniffKind(head) ?? sniffByName(head, file.name) ?? (accept.includes('text') && looksLikeText(head, file.name) ? 'text' : null)
    if (!kind && isLegacyOffice(head) && accept.some((k) => k === 'docx' || k === 'xlsx')) {
      rejected.push(msg('val.legacyOffice', { name: file.name }))
      continue
    }
    if (!kind || !accept.includes(kind)) {
      rejected.push(kind ? msg('val.wrongTypeLooks', { name: file.name, expected, actual: KIND_LABEL[kind] }) : msg('val.wrongType', { name: file.name, expected }))
      continue
    }
    // TIFF pages are measured one by one when decoded (a file can hold many); text has no pixels.
    if (kind === 'jpeg' || kind === 'png' || kind === 'webp') {
      const dims = imageDimensions(head, kind) ?? (kind === 'jpeg' ? await jpegDimensionsFromFile(file) : null)
      if (!dims || !dims.width || !dims.height) {
        rejected.push(msg('val.noDims', { name: file.name }))
        continue
      }
      if (dims.width * dims.height > LIMITS.maxImagePixels) {
        rejected.push(msg('val.tooManyPixels', { name: file.name, w: dims.width, h: dims.height }))
        continue
      }
    }
    total += file.size
    const markers = kind === 'pdf' ? await scanPdfMarkers(file) : {}
    accepted.push({ id: newId(), file, name: file.name, kind, size: file.size, ...markers })
  }
  return { accepted, rejected }
}
