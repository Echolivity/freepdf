import { useEffect, useRef, useState } from 'react'
import { renderPage, type PDFDocumentProxy } from '../lib/render/pdfjs'
import { usePdfDoc } from './usePdfDoc'
import type { ValidatedFile } from '../lib/validate'
import { Icon } from './Icon'
import { useI18n } from '../i18n/context'

/* ---------- tiny render scheduler: at most 2 thumbnails rendering at once ---------- */
const MAX_CONCURRENT = 2
let active = 0
const queue: (() => void)[] = []
function schedule<T>(task: () => Promise<T>): { promise: Promise<T>; cancel: () => void } {
  let cancelled = false
  let start!: () => void
  const promise = new Promise<T>((resolve, reject) => {
    start = () => {
      if (cancelled) { next(); return reject(new Error('cancelled')) }
      active++
      task().then(resolve, reject).finally(() => { active--; next() })
    }
  })
  queue.push(start)
  next()
  return { promise, cancel: () => { cancelled = true } }
}
function next() {
  while (active < MAX_CONCURRENT && queue.length) queue.shift()!()
}

/* ---------- a single lazily-rendered page thumbnail ---------- */
export function PageThumb({ doc, pageNumber, width = 160, rotation = 0 }: { doc: PDFDocumentProxy; pageNumber: number; width?: number; rotation?: number }) {
  const host = useRef<HTMLDivElement>(null)
  const [aspect, setAspect] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const { t } = useI18n()

  useEffect(() => {
    const el = host.current
    if (!el) return
    let job: ReturnType<typeof schedule<HTMLCanvasElement>> | null = null
    let dead = false
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || job) return
        io.disconnect()
        job = schedule(async () => {
          const page = await doc.getPage(pageNumber)
          const vp = page.getViewport({ scale: 1 })
          const scale = (width * Math.min(window.devicePixelRatio || 1, 2)) / vp.width
          return (await renderPage(doc, pageNumber, scale)).canvas
        })
        job.promise.then(
          (canvas) => {
            if (dead) return
            canvas.className = 'block h-auto w-full'
            setAspect(canvas.height / canvas.width)
            el.replaceChildren(canvas)
          },
          () => { if (!dead) setFailed(true) },
        )
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => { dead = true; io.disconnect(); job?.cancel() }
  }, [doc, pageNumber, width])

  const turned = rotation % 180 !== 0
  const a = aspect ?? 1.414
  // Box keeps the rotated page's footprint; inner page is rotated with CSS (no re-render needed).
  return (
    <div className="relative grid w-full place-items-center overflow-hidden" style={{ aspectRatio: turned ? `${a} / 1` : `1 / ${a}` }}>
      <div
        className="bg-white shadow-[0_0_0_1px_var(--line)] transition-transform duration-200"
        style={{ width: turned ? `${100 / a}%` : '100%', transform: `rotate(${rotation}deg)` }}
      >
        <div ref={host} style={{ aspectRatio: `1 / ${a}` }} className={aspect ? '' : 'animate-pulse bg-surface-2'} />
      </div>
      {failed && (
        <span className="absolute inset-0 grid place-items-center text-xs text-muted">{t('thumb.unavailable')}</span>
      )}
    </div>
  )
}

/* ---------- first-page preview for a file list row ---------- */
export function FileThumb({ file }: { file: ValidatedFile }) {
  // Browsers can't show TIFF (except Safari) or text in an <img>: show what the file is instead.
  if (file.kind === 'tiff' || file.kind === 'text') {
    return (
      <span className="grid h-full w-full place-items-center text-muted" aria-hidden="true">
        <span className="flex flex-col items-center gap-0.5">
          <Icon name={file.kind === 'tiff' ? 'tiffIn' : 'textIn'} size={20} />
          <span className="text-[10px] font-bold tracking-wide">{file.kind === 'tiff' ? 'TIFF' : 'TXT'}</span>
        </span>
      </span>
    )
  }
  if (file.kind !== 'pdf') return <ImageThumb file={file} />
  return <PdfFirstPage file={file} />
}

function ImageThumb({ file }: { file: ValidatedFile }) {
  // The object URL lives exactly as long as this element: created and revoked by the same effect.
  const img = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const u = URL.createObjectURL(file.file)
    if (img.current) img.current.src = u
    return () => URL.revokeObjectURL(u)
  }, [file])
  return <img ref={img} alt="" className="h-full w-full object-contain" />
}

function PdfFirstPage({ file }: { file: ValidatedFile }) {
  const { doc, error } = usePdfDoc(file)
  if (error) return <Icon name="lock" className="text-muted" />
  if (!doc) return <span className="h-full w-full animate-pulse bg-surface-2" />
  return <PageThumb doc={doc} pageNumber={1} width={64} />
}
