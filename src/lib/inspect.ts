/**
 * Streaming pre-check of a PDF's raw bytes, run when a file is added (before any processing):
 *
 *  - signed:    a signature value dictionary with a real /ByteRange [a b c d] array is present.
 *               An empty signature *field* (nothing signed yet) is not reported.
 *  - certified: a certification signature (/DocMDP) — the author locked the document against changes.
 *  - encrypted: an /Encrypt entry in a trailer or cross-reference stream dictionary
 *               (password or permissions protection).
 *
 * Patterns are matched on the raw bytes as Latin-1, so binary data can't produce invalid text, and
 * each requires the syntax that only the real structure has (a 4-number array, an object reference or
 * a dictionary), which keeps the words appearing in page text from triggering it.
 *
 * Known limit: signature dictionaries stored inside compressed object streams are not seen. Signing
 * tools practically never do that, because /ByteRange must be patched in place after writing.
 */
const CHUNK = 4 * 1024 * 1024
const OVERLAP = 256
const decoder = new TextDecoder('latin1')

const SIGNED = /\/ByteRange\s*\[\s*\d+\s+\d+\s+\d+\s+\d+\s*\]/
const CERTIFIED = /\/TransformMethod\s*\/DocMDP\b|\/DocMDP\s+\d+\s+\d+\s+R|\/DocMDP\s*<</
const ENCRYPTED = /\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/

export interface PdfMarkers {
  signed: boolean
  certified: boolean
  encrypted: boolean
}

export async function scanPdfMarkers(file: Blob): Promise<PdfMarkers> {
  const found: PdfMarkers = { signed: false, certified: false, encrypted: false }
  for (let pos = 0; pos < file.size; pos += CHUNK) {
    const text = decoder.decode(await file.slice(Math.max(0, pos - OVERLAP), pos + CHUNK).arrayBuffer())
    if (!found.signed && SIGNED.test(text)) found.signed = true
    if (!found.certified && CERTIFIED.test(text)) found.certified = true
    if (!found.encrypted && ENCRYPTED.test(text)) found.encrypted = true
    if (found.signed && found.certified && found.encrypted) break
  }
  // A certification is itself a signature.
  if (found.certified) found.signed = true
  return found
}
