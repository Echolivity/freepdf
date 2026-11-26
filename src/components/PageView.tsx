import { useEffect, useRef, useState, type ReactNode } from 'react'
import { releaseCanvas, renderPage, type PDFDocumentProxy } from '../lib/render/pdfjs'

/** A page's displayed size in points, and the mapping from displayed (x, y) to PDF user space. */
export interface PageInfo {
  w: number
  h: number
  toPdf: (x: number, y: number) => [number, number]
}

/** One page: rendered when it scrolls into view, at the width it's shown. */
export function PageView({ doc, n, info, label, children, onVisible }: { doc: PDFDocumentProxy; n: number; info: PageInfo; label: string; children: (k: number) => ReactNode; onVisible: (n: number) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const holder = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); onVisible(n) } }, { rootMargin: '400px 0px', threshold: 0 })
    io.observe(el)
    return () => { ro.disconnect(); io.disconnect() }
  }, [n, onVisible])
  useEffect(() => {
    if (!seen || !width || !holder.current) return
    let dead = false
    let canvas: HTMLCanvasElement | null = null
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    renderPage(doc, n + 1, (width / info.w) * dpr).then((r) => {
      canvas = r.canvas
      if (dead || !holder.current) { releaseCanvas(canvas); return }
      canvas.className = 'absolute inset-0 h-full w-full'
      canvas.setAttribute('aria-hidden', 'true')
      holder.current.replaceChildren(canvas)
    }).catch(() => {})
    return () => { dead = true; if (canvas) releaseCanvas(canvas) }
  }, [seen, width, doc, n, info.w])
  const k = width ? width / info.w : 0
  return (
    <section aria-label={label} className="relative">
      <div ref={box} className="relative w-full overflow-hidden rounded-lg bg-white shadow-card ring-1 ring-line" style={{ aspectRatio: `${info.w} / ${info.h}` }} data-testid={`page-${n + 1}`}>
        <div ref={holder} className="absolute inset-0" />
        {k > 0 && children(k)}
      </div>
    </section>
  )
}

