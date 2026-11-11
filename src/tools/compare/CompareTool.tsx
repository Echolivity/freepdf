import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { ProgressPanel } from '../../components/JobPanels'
import { Button, LocalBadge, Notice, Rejections, Segmented, Workspace } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { readBytes, useFiles } from '../../components/useFiles'
import { useJob } from '../../components/useJob'
import { buildComparison, extractWords, tokenIds, type Comparison, type Word } from '../../lib/compare/compare'
import { diffPixels } from '../../lib/compare/pixels'
import { deriveName } from '../../lib/files'
import { downloadBlob, pdfBlob } from '../../lib/output'
import { canvasToBlob, closePdf, openPdf, PasswordRequiredError, releaseCanvas, renderPage, type PDFDocumentProxy } from '../../lib/render/pdfjs'
import { UserFacingError, type FileKind, type ValidatedFile } from '../../lib/validate'
import { CancelledError, runInWorker } from '../../lib/workerClient'
import { useI18n } from '../../i18n/context'

const ACCEPT: FileKind[] = ['pdf']
const REMOVED = 'rgba(220, 38, 38, 0.32)'
const ADDED = 'rgba(22, 163, 74, 0.32)'
/** A page pair counts as visually changed above this share of differing pixels (≈7 px at the scan resolution; identical pages render identically). */
const VISUAL_THRESHOLD = 0.00002

interface Loaded {
  cmp: Comparison
  docA: PDFDocumentProxy
  docB: PDFDocumentProxy
  nameA: string
  nameB: string
}

async function open(f: ValidatedFile) {
  try {
    return await openPdf(await readBytes(f), { name: f.name, forExport: true })
  } catch (e) {
    if (e instanceof PasswordRequiredError) throw new UserFacingError('err.encrypted', { name: f.name })
    throw e
  }
}

/** Render a page and (optionally) paint word highlights over it. Returns null when the page doesn't exist. */
async function renderMarked(doc: PDFDocumentProxy, index: number, width: number, words: Word[] | null, flags: Uint8Array | null, color: string) {
  if (index >= doc.numPages) return null
  const page = await doc.getPage(index + 1)
  const base = page.getViewport({ scale: 1 })
  const { canvas, scaleUsed } = await renderPage(doc, index + 1, Math.min(3, width / base.width))
  if (words && flags) {
    const vp = page.getViewport({ scale: scaleUsed })
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = color
    for (let i = 0; i < words.length; i++) {
      const w = words[i]
      if (w.page !== index || !flags[i] || !w.box) continue
      const [x1, y1] = vp.convertToViewportPoint(w.box[0], w.box[1]) as number[]
      const [x2, y2] = vp.convertToViewportPoint(w.box[0] + w.box[2], w.box[1] + w.box[3]) as number[]
      ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
    }
  }
  page.cleanup()
  return canvas
}

function pixelsOf(c: HTMLCanvasElement) {
  return { width: c.width, height: c.height, data: c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data }
}

function CanvasView({ canvas, label }: { canvas: HTMLCanvasElement | null; label: string }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = host.current
    if (!el || !canvas) return
    el.replaceChildren(canvas)
    return () => { el.replaceChildren() }
  }, [canvas])
  return <div ref={host} role="img" aria-label={label} className="overflow-hidden rounded-lg border border-line bg-paper [&>canvas]:block [&>canvas]:h-auto [&>canvas]:w-full" />
}

export default function CompareTool() {
  const { t, tm } = useI18n()
  const sel = useFiles(ACCEPT, { multiple: true })
  const job = useJob()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const loadedRef = useRef<Loaded | null>(null)

  const replace = useCallback((next: Loaded | null) => {
    const prev = loadedRef.current
    if (prev && prev !== next) { closePdf(prev.docA); closePdf(prev.docB) }
    loadedRef.current = next
    setLoaded(next)
  }, [])
  useEffect(() => () => replace(null), [replace])

  const startOver = () => { job.reset(); replace(null); sel.clear() }
  const two = sel.files.length === 2

  const run = () =>
    job.run(async ({ signal, progress }) => {
      const [fa, fb] = sel.files
      progress(0, { key: 'cpr.reading' })
      const docA = await open(fa)
      let docB: PDFDocumentProxy | null = null
      try {
        docB = await open(fb)
        const a = await extractWords(docA, { signal, onPage: (d, n) => progress(0.45 * (d / n), { key: 'cpr.readingText', params: { name: fa.name } }) })
        const b = await extractWords(docB, { signal, onPage: (d, n) => progress(0.45 + 0.45 * (d / n), { key: 'cpr.readingText', params: { name: fb.name } }) })
        progress(0.92, { key: 'cpr.comparing' })
        const ids = tokenIds(a.words, b.words)
        const runs = await runInWorker('diffTokens', ids, { signal })
        if (signal.aborted) throw new CancelledError()
        replace({ cmp: buildComparison(a, b, runs), docA, docB, nameA: fa.name, nameB: fb.name })
        return []
      } catch (e) {
        closePdf(docA)
        closePdf(docB)
        throw e
      }
    })

  if (job.status === 'running') return <ProgressPanel job={job} />
  if (job.status === 'done' && loaded) return <Results data={loaded} onStartOver={startOver} />

  return (
    <div className="space-y-5">
      <Rejections items={sel.rejections} onDismiss={() => sel.setRejections([])} />
      {job.status === 'error' && job.error && <Notice tone="error" onDismiss={job.reset}>{tm(job.error)}</Notice>}
      {!sel.files.length ? (
        <>
          <p className="text-muted">{t('cpr.intro')}</p>
          <Dropzone accept={ACCEPT} multiple onFiles={sel.add} />
        </>
      ) : (
        <Workspace
          main={
            <div className="space-y-3">
              <FileList
                files={sel.files}
                reorderable
                onMove={sel.move}
                onRemove={sel.remove}
                modifiesPdf={false}
                extra={(f) => {
                  const i = sel.files.indexOf(f)
                  return ` · ${i === 0 ? t('cpr.original') : i === 1 ? t('cpr.changed') : t('cpr.extra')}`
                }}
              />
              {sel.files.length < 2 && <Dropzone accept={ACCEPT} multiple compact onFiles={sel.add} />}
            </div>
          }
          side={
            <>
              <p className="text-sm text-muted">{t('cpr.how')}</p>
              {sel.files.length > 2 && <p className="text-sm font-semibold text-danger" role="alert">{t('cpr.exactlyTwo')}</p>}
              {sel.files.length === 2 && (
                <Button size="sm" variant="ghost" icon="refresh" onClick={() => sel.move(0, 1)} data-testid="swap">{t('cpr.swap')}</Button>
              )}
              <Button variant="primary" size="lg" icon="compare" className="w-full" disabled={!two} onClick={run} data-testid="run">
                {t('cpr.run')}
              </Button>
              <p className="text-sm text-muted">{t('cpr.readOnly')}</p>
              <LocalBadge />
            </>
          }
        />
      )}
    </div>
  )
}

type View = 'side' | 'overlay'

function Results({ data, onStartOver }: { data: Loaded; onStartOver: () => void }) {
  const { t, lang } = useI18n()
  const { cmp, docA, docB } = data
  const total = Math.max(docA.numPages, docB.numPages)
  const [visual, setVisual] = useState<{ ratios: number[]; done: number } | null>(null)
  const scanAbort = useRef<AbortController | null>(null)
  const visualChanged = useMemo(() => (visual ? visual.ratios.flatMap((r, i) => (r > VISUAL_THRESHOLD ? [i] : [])) : []), [visual])
  const changedPages = useMemo(() => [...new Set([...cmp.changedPages, ...visualChanged])].sort((a, b) => a - b), [cmp.changedPages, visualChanged])
  const [index, setIndex] = useState(() => cmp.changedPages[0] ?? 0)
  const [view, setView] = useState<View>('side')
  const [tolerance, setTolerance] = useState(32)
  const [canvases, setCanvases] = useState<{ a: HTMLCanvasElement | null; b: HTMLCanvasElement | null; diff: HTMLCanvasElement | null; ratio: number | null } | null>(null)
  const [report, setReport] = useState<{ busy: boolean; progress: number }>({ busy: false, progress: 0 })
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])

  // Render the current page pair.
  useEffect(() => {
    let dead = false
    const made: HTMLCanvasElement[] = []
    ;(async () => {
      const width = 900
      if (view === 'side') {
        const a = await renderMarked(docA, index, width, cmp.wordsA, cmp.removedA, REMOVED)
        const b = await renderMarked(docB, index, width, cmp.wordsB, cmp.addedB, ADDED)
        if (a) made.push(a)
        if (b) made.push(b)
        if (!dead) setCanvases({ a, b, diff: null, ratio: null })
      } else {
        const a = await renderMarked(docA, index, width, null, null, '')
        const b = await renderMarked(docB, index, width, null, null, '')
        const blank = { width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255]) }
        const d = diffPixels(a ? pixelsOf(a) : blank, b ? pixelsOf(b) : blank, tolerance)
        for (const c of [a, b]) if (c) releaseCanvas(c)
        const out = document.createElement('canvas')
        out.width = d.width
        out.height = d.height
        out.getContext('2d')!.putImageData(new ImageData(d.data as Uint8ClampedArray<ArrayBuffer>, d.width, d.height), 0, 0)
        made.push(out)
        if (!dead) setCanvases({ a: null, b: null, diff: out, ratio: d.ratio })
      }
    })().catch(() => { if (!dead) setCanvases({ a: null, b: null, diff: null, ratio: null }) })
    return () => {
      dead = true
      // Release after React has swapped them out.
      setTimeout(() => made.forEach(releaseCanvas), 0)
    }
  }, [docA, docB, cmp, index, view, tolerance])

  useEffect(() => () => scanAbort.current?.abort(), [])

  const scan = async () => {
    scanAbort.current?.abort()
    const ac = new AbortController()
    scanAbort.current = ac
    const ratios: number[] = []
    setVisual({ ratios: [], done: 0 })
    for (let i = 0; i < total; i++) {
      if (ac.signal.aborted) return
      const a = await renderMarked(docA, i, 500, null, null, '')
      const b = await renderMarked(docB, i, 500, null, null, '')
      if (!a || !b) ratios.push(1)
      else ratios.push(diffPixels(pixelsOf(a), pixelsOf(b), tolerance).ratio)
      for (const c of [a, b]) if (c) releaseCanvas(c)
      if (!ac.signal.aborted) setVisual({ ratios: [...ratios], done: i + 1 })
    }
  }

  const makeReport = async () => {
    const pages = changedPages.length ? changedPages : []
    if (!pages.length) return
    setReport({ busy: true, progress: 0 })
    try {
      const images = []
      for (let k = 0; k < pages.length; k++) {
        const i = pages[k]
        const a = await renderMarked(docA, i, 700, cmp.wordsA, cmp.removedA, REMOVED)
        const b = await renderMarked(docB, i, 700, cmp.wordsB, cmp.addedB, ADDED)
        const head = 56
        const gap = 24
        const w = 700 * 2 + gap + 48
        const h = head + Math.max(a?.height ?? 200, b?.height ?? 200) + 24
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')!
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#111'
        ctx.font = '600 22px system-ui, sans-serif'
        ctx.direction = lang === 'ar' ? 'rtl' : 'ltr'
        ctx.textAlign = lang === 'ar' ? 'right' : 'left'
        const x0 = lang === 'ar' ? w - 24 : 24
        ctx.fillText(t('cpr.reportPage', { page: i + 1 }), x0, 34)
        ctx.font = '15px system-ui, sans-serif'
        ctx.fillStyle = '#555'
        ctx.textAlign = 'left'
        ctx.direction = 'ltr'
        ctx.fillText(`${data.nameA}`, 24, head - 4, 700)
        ctx.fillText(`${data.nameB}`, 24 + 700 + gap, head - 4, 700)
        const place = (cv: HTMLCanvasElement | null, x: number) => {
          if (!cv) {
            ctx.strokeStyle = '#bbb'
            ctx.strokeRect(x, head + 8, 700, 200)
            return
          }
          const scale = Math.min(1, 700 / cv.width)
          ctx.drawImage(cv, x, head + 8, cv.width * scale, cv.height * scale)
          ctx.strokeStyle = '#ccc'
          ctx.strokeRect(x, head + 8, cv.width * scale, cv.height * scale)
        }
        place(a, 24)
        place(b, 24 + 700 + gap)
        for (const cv of [a, b]) if (cv) releaseCanvas(cv)
        const blob = await canvasToBlob(c, 'image/jpeg', 0.85)
        releaseCanvas(c)
        images.push({ name: `page-${i + 1}.jpg`, kind: 'jpeg' as const, bytes: new Uint8Array(await blob.arrayBuffer()) })
        setReport({ busy: true, progress: (k + 1) / (pages.length + 1) })
      }
      const pdf = await runInWorker('imagesToPdf', { images, options: { pageSize: 'fit', orientation: 'auto', margin: 0 } })
      downloadBlob(pdfBlob(pdf), deriveName(data.nameB, '-comparison', 'pdf'))
    } finally {
      setReport({ busy: false, progress: 0 })
    }
  }

  const pageChanges = cmp.changes.filter((c) => c.pageA === index || c.pageB === index)
  const identical = !changedPages.length && !cmp.noText
  const go = (i: number) => setIndex(Math.max(0, Math.min(total - 1, i)))

  return (
    <section className="fade-in space-y-5" aria-labelledby="cmp-h">
      <div className="rounded-2xl border border-line bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="cmp-h" ref={heading} tabIndex={-1} className="text-2xl font-semibold focus:outline-none">
              {cmp.noText ? t('cpr.noTextHeading') : identical ? t('cpr.sameText') : t('cpr.summary', { count: cmp.changes.length })}
            </h2>
            <p className="mt-1 text-sm text-muted" data-testid="cmp-stats">
              {t('cpr.stats', { removed: cmp.removedCount, added: cmp.addedCount, a: docA.numPages, b: docB.numPages })}
            </p>
          </div>
          <Button variant="ghost" onClick={onStartOver}>{t('job.startOver')}</Button>
        </div>
        {cmp.noText && <Notice tone="info">{t('cpr.noText')}</Notice>}
        {docA.numPages !== docB.numPages && <p className="mt-3 text-sm font-semibold" role="status">{t('cpr.pageCountDiffers', { a: docA.numPages, b: docB.numPages })}</p>}
        {cmp.sizeChanged.length > 0 && <p className="mt-2 text-sm" role="status">{t('cpr.sizeDiffers', { pages: cmp.sizeChanged.map((i) => i + 1).join(', ') })}</p>}
        {identical && <p className="mt-3 text-sm text-muted">{t('cpr.sameTextNote')}</p>}
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold">{t('cpr.changedPages')}</p>
          {changedPages.length ? (
            <div className="flex flex-wrap gap-2" data-testid="cmp-pages">
              {changedPages.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-pressed={i === index}
                  className={`min-w-10 rounded-lg border px-2.5 py-1 text-sm font-semibold tabular-nums ${i === index ? 'border-accent bg-accent-soft' : 'border-line bg-paper hover:border-line-strong'}`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">{t('cpr.none')}</p>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="sm" icon="search" onClick={scan} disabled={!!visual && visual.done < total} data-testid="cmp-scan">
            {visual && visual.done < total ? t('cpr.scanning', { done: visual.done, total }) : t('cpr.scan')}
          </Button>
          {visual && visual.done === total && <span className="text-sm text-muted" role="status" data-testid="cmp-scan-result">{t('cpr.scanResult', { count: visualChanged.length })}</span>}
          <Button size="sm" variant="primary" icon="download" onClick={makeReport} disabled={!changedPages.length || report.busy} data-testid="cmp-report">
            {report.busy ? t('cpr.reportBusy', { pct: Math.round(report.progress * 100) }) : t('cpr.report')}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => go(index - 1)} disabled={index <= 0} aria-label={t('cpr.prev')}>
              <Icon name="arrowLeft" size={18} className="rtl:-scale-x-100" />
            </Button>
            <span className="text-sm font-semibold tabular-nums" data-testid="cmp-page">{t('cpr.pageOf', { page: index + 1, total })}</span>
            <Button size="sm" variant="ghost" onClick={() => go(index + 1)} disabled={index >= total - 1} aria-label={t('cpr.next')}>
              <Icon name="arrowLeft" size={18} className="-scale-x-100 rtl:scale-x-100" />
            </Button>
          </div>
          <div className="w-full sm:w-72">
            <Segmented<View> label={t('cpr.view')} value={view} onChange={setView} options={[{ value: 'side', label: t('cpr.view.side') }, { value: 'overlay', label: t('cpr.view.overlay') }]} />
          </div>
        </div>
        {view === 'overlay' && (
          <label className="mt-3 block max-w-sm">
            <span className="mb-1 block text-sm font-semibold">{t('cpr.tolerance', { value: tolerance })}</span>
            <input type="range" min={0} max={128} step={4} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
          </label>
        )}
        <div className="mt-4">
          {view === 'side' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <figure>
                <figcaption className="mb-1 truncate text-sm font-semibold" dir="auto"><span className="me-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-[rgba(220,38,38,0.6)]" />{data.nameA}</figcaption>
                {canvases?.a ? <CanvasView canvas={canvases.a} label={t('cpr.altA', { page: index + 1 })} /> : <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">{index >= docA.numPages ? t('cpr.noPage') : t('common.readingPages')}</p>}
              </figure>
              <figure>
                <figcaption className="mb-1 truncate text-sm font-semibold" dir="auto"><span className="me-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-[rgba(22,163,74,0.6)]" />{data.nameB}</figcaption>
                {canvases?.b ? <CanvasView canvas={canvases.b} label={t('cpr.altB', { page: index + 1 })} /> : <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">{index >= docB.numPages ? t('cpr.noPage') : t('common.readingPages')}</p>}
              </figure>
            </div>
          ) : (
            <figure className="mx-auto max-w-2xl">
              {canvases?.diff ? <CanvasView canvas={canvases.diff} label={t('cpr.altDiff', { page: index + 1 })} /> : <p className="p-6 text-center text-sm text-muted">{t('common.readingPages')}</p>}
              <figcaption className="mt-2 text-sm text-muted" data-testid="cmp-ratio">
                {canvases?.ratio != null ? t('cpr.diffLegend', { pct: (canvases.ratio * 100).toFixed(2) }) : ''}
              </figcaption>
            </figure>
          )}
        </div>
        <div className="mt-5">
          <h3 className="mb-2 font-semibold">{t('cpr.pageChanges', { count: pageChanges.length })}</h3>
          {pageChanges.length ? (
            <ul className="space-y-2" data-testid="cmp-changes">
              {pageChanges.slice(0, 200).map((c, k) => (
                <li key={k} className="rounded-lg border border-line bg-paper px-3 py-2 text-[15px]">
                  {c.removed && <del className="me-2 rounded bg-danger-soft px-1 text-ink decoration-danger decoration-2" dir="auto">{c.removed}</del>}
                  {c.added && <ins className="rounded bg-ok-soft px-1 text-ink no-underline" dir="auto">{c.added}</ins>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{t('cpr.pageNoText')}</p>
          )}
        </div>
      </div>
      <p className="text-sm text-muted">{t('cpr.limits')}</p>
    </section>
  )
}
