import { useEffect, useState } from 'react'
import { closePdf, openPdf, type PDFDocumentProxy } from '../lib/render/pdfjs'

/** Open PDF bytes with PDF.js (rendering in its worker); closed when the bytes change or on unmount. */
export function usePdfFromBytes(bytes: Uint8Array | null, name = 'preview.pdf') {
  const [state, setState] = useState<{ bytes: Uint8Array; doc: PDFDocumentProxy | null; failed: boolean } | null>(null)
  useEffect(() => {
    if (!bytes) return
    let doc: PDFDocumentProxy | null = null
    let dead = false
    openPdf(bytes.slice(), { name })
      .then((d) => {
        doc = d
        if (dead) closePdf(d)
        else setState({ bytes, doc: d, failed: false })
      })
      .catch(() => { if (!dead) setState({ bytes, doc: null, failed: true }) })
    return () => { dead = true; closePdf(doc) }
  }, [bytes, name])
  const current = bytes && state?.bytes === bytes ? state : null
  return { doc: current?.doc ?? null, failed: current?.failed ?? false, loading: !!bytes && !current }
}
