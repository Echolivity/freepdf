import { PDFDocument, EncryptedPDFError, degrees } from 'pdf-lib'
import { UserFacingError } from '../validate'
import type { Message } from '../../i18n/core'

export interface NamedBytes {
  name: string
  bytes: Uint8Array
}

export type ProgressFn = (fraction: number, label?: Message) => void
export const noProgress: ProgressFn = () => {}

// updateFieldAppearances:false — we never change form values, and regenerating appearances would embed fonts and alter forms.
const SAVE_OPTS = { useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false } as const

/** Load a PDF with pdf-lib, converting library errors into messages a person can act on. */
export async function loadPdf(bytes: Uint8Array, name = 'This file'): Promise<PDFDocument> {
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false })
  } catch (err) {
    if (err instanceof EncryptedPDFError || /encrypt/i.test(String((err as Error)?.message))) {
      throw new UserFacingError('err.encrypted', { name })
    }
    throw new UserFacingError('err.unreadable', { name })
  }
  let count = 0
  try {
    count = doc.getPageCount()
  } catch {
    throw new UserFacingError('err.noPageList', { name })
  }
  if (count === 0) throw new UserFacingError('err.noPages', { name })
  return doc
}

export async function saveDoc(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save(SAVE_OPTS)
}

/** Build a new document from (page index, extra rotation) pairs of a source document. */
export async function assemble(
  src: PDFDocument,
  pages: { index: number; rotate?: number }[],
): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, pages.map((p) => p.index))
  copied.forEach((page, i) => {
    const extra = pages[i].rotate ?? 0
    if (extra) page.setRotation(degrees(normalizeAngle(page.getRotation().angle + extra)))
    out.addPage(page)
  })
  copyDocumentInfo(src, out)
  return saveDoc(out)
}

export function normalizeAngle(a: number): number {
  return ((Math.round(a / 90) * 90) % 360 + 360) % 360
}

/** Carry title/author/subject/keywords (any script, e.g. Arabic) into a newly built document. */
export function copyDocumentInfo(src: PDFDocument, out: PDFDocument) {
  try {
    const title = src.getTitle()
    if (title) out.setTitle(title)
    const author = src.getAuthor()
    if (author) out.setAuthor(author)
    const subject = src.getSubject()
    if (subject) out.setSubject(subject)
    const keywords = src.getKeywords()
    if (keywords) out.setKeywords([keywords])
  } catch {
    /* metadata is optional */
  }
  out.setProducer('FreePDF')
  out.setCreator('FreePDF')
}
