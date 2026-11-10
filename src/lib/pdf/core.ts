import { PDFDocument, EncryptedPDFError, degrees } from 'pdf-lib'
import { UserFacingError } from '../validate'

export interface NamedBytes {
  name: string
  bytes: Uint8Array
}

export type ProgressFn = (fraction: number, label?: string) => void
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
      throw new UserFacingError(
        `“${name}” is password-protected. Remove the password in the app you used to set it, then try again.`,
      )
    }
    throw new UserFacingError(`“${name}” couldn't be read. It may be damaged or not a real PDF.`)
  }
  let count = 0
  try {
    count = doc.getPageCount()
  } catch {
    throw new UserFacingError(`“${name}” is damaged: its page list can't be read.`)
  }
  if (count === 0) throw new UserFacingError(`“${name}” has no pages.`)
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
  copyBasicMetadata(src, out)
  return saveDoc(out)
}

export function normalizeAngle(a: number): number {
  return ((Math.round(a / 90) * 90) % 360 + 360) % 360
}

function copyBasicMetadata(src: PDFDocument, out: PDFDocument) {
  try {
    const title = src.getTitle()
    if (title) out.setTitle(title)
  } catch {
    /* metadata is optional */
  }
  out.setProducer('FreePDF')
  out.setCreator('FreePDF')
}
