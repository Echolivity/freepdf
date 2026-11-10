/**
 * Cheap, streaming pre-check of a PDF's raw bytes, run when a file is added (before any processing):
 *  - signed: a signature dictionary (/ByteRange) is present. Any rewrite of the file invalidates it.
 *  - encrypted: an /Encrypt entry is present (password or permissions protection).
 * Reads the file in chunks so large files don't need a full copy in memory at once.
 */
const enc = new TextEncoder()
const MARKERS = { signed: enc.encode('/ByteRange'), encrypted: enc.encode('/Encrypt') }
const CHUNK = 4 * 1024 * 1024

function indexOf(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    if (hay[i] !== needle[0]) continue
    for (let j = 1; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

export async function scanPdfMarkers(file: Blob): Promise<{ signed: boolean; encrypted: boolean }> {
  const found = { signed: false, encrypted: false }
  const overlap = 16
  for (let pos = 0; pos < file.size && !(found.signed && found.encrypted); pos += CHUNK) {
    const chunk = new Uint8Array(await file.slice(Math.max(0, pos - overlap), pos + CHUNK).arrayBuffer())
    if (!found.signed && indexOf(chunk, MARKERS.signed) >= 0) found.signed = true
    if (!found.encrypted && indexOf(chunk, MARKERS.encrypted) >= 0) found.encrypted = true
  }
  return found
}
