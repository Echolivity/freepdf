import { useEffect, useState } from 'react'
import { closePdf, openPdf, PasswordRequiredError, type PDFDocumentProxy } from '../lib/render/pdfjs'
import { UserFacingError, type ValidatedFile } from '../lib/validate'
import type { Message } from '../i18n/core'

interface Loaded {
  file: ValidatedFile
  doc: PDFDocumentProxy | null
  error: Message | null
}

/**
 * Open a PDF with PDF.js for previews. State is keyed by the file it belongs to, so "loading" is derived
 * (no synchronous resets inside the effect) and a stale result can never be shown for a newer file.
 */
export function usePdfDoc(file: ValidatedFile | null) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    if (!file) return
    let doc: PDFDocumentProxy | null = null
    let dead = false
    ;(async () => {
      try {
        doc = await openPdf(new Uint8Array(await file.file.arrayBuffer()), { name: file.name })
        if (dead) { closePdf(doc); return }
        setLoaded({ file, doc, error: null })
      } catch (err) {
        if (dead) return
        const error: Message = err instanceof PasswordRequiredError
          ? { key: 'err.encrypted', params: { name: file.name } }
          : err instanceof UserFacingError ? err.toMessage() : { key: 'err.cantOpen', params: { name: file.name } }
        setLoaded({ file, doc: null, error })
      }
    })()
    return () => { dead = true; closePdf(doc) }
  }, [file])

  const current = file && loaded?.file === file ? loaded : null
  return { doc: current?.doc ?? null, error: current?.error ?? null, loading: !!file && !current }
}
