import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { ToolFrame } from '../../components/ToolFrame'
import { Button, LocalBadge, Notice, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useJob } from '../../components/useJob'
import { usePdfDoc } from '../../components/usePdfDoc'
import { PageView, type PageInfo } from '../../components/PageView'
import { Icon } from '../../components/Icon'
import type { ToolDef } from '../registry'
import { deriveName } from '../../lib/files'
import { canvasToBlob, releaseCanvas, renderPage, type PDFDocumentProxy } from '../../lib/render/pdfjs'
import { runInWorker } from '../../lib/workerClient'
import { findOnPage, keptWords, PATTERNS, readSpans, type Box, type PageSpans, type PatternId } from '../../lib/redact/find'
import type { RedactPage } from '../../lib/pdf/redact'
import type { FileKind } from '../../lib/validate'
import type { OutputFile } from '../../lib/output'
import { useI18n } from '../../i18n/context'

const ACCEPT: FileKind[] = ['pdf']
/** Resolution of the rebuilt pages. */
const DPI = 200

interface Mark extends Box { id: string }
let seq = 0
const uid = () => `r${++seq}`
const pct = (v: number, of: number) => `${(v / of) * 100}%`

/** Displayed page sizes, read once per document. */
function usePages(doc: PDFDocumentProxy | null) {
  const [state, setState] = useState<{ doc: unknown; pages: PageInfo[] } | null>(null)
  useEffect(() => {
    if (!doc) return
    let dead = false
    ;(async () => {
      const pages: PageInfo[] = []
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i)
        const vp = page.getViewport({ scale: 1 })
        pages.push({ w: vp.width, h: vp.height, toPdf: (x, y) => vp.convertToPdfPoint(x, y) as [number, number] })
        page.cleanup()
        if (dead) return
      }
      if (!dead) setState({ doc, pages })
    })().catch(() => {})
    return () => { dead = true }
  }, [doc])
  return state?.doc === doc ? state.pages : null
}

/**
 * Redact PDF: mark areas by hand or find text and patterns (emails, phone numbers, IBANs, card and ID
 * numbers), then remove them for real: redacted pages are rebuilt so the covered content is gone from
 * the file. Everything stays in the browser.
 */
export default function RedactTool({ tool }: { tool: ToolDef }) {
  const { t } = useI18n()
  const sel = useFiles(ACCEPT, { multiple: false })
  const job = useJob()
  const file = sel.files[0] ?? null
  const { doc, error } = usePdfDoc(file)
  const pages = usePages(doc)
  const [marks, setMarks] = useState<Mark[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [patterns, setPatterns] = useState<PatternId[]>([])
  // Everything searched for so far: also kept out of the searchable text of redacted pages.
  const [used, setUsed] = useState<{ terms: string[]; patterns: PatternId[] }>({ terms: [], patterns: [] })
  const [found, setFound] = useState<{ matches: number; pages: number } | null>(null)
  const [searching, setSearching] = useState(false)
  const [keepText, setKeepText] = useState(true)
  const [sanitize, setSanitize] = useState(true)
  // Text runs per page, read on first search; tied to the document they came from.
  const spans = useRef<{ doc: unknown; map: Map<number, PageSpans> }>({ doc: null, map: new Map() })
  const draft = useRef<{ id: string; page: number; x0: number; y0: number } | null>(null)

  const [loadedFor, setLoadedFor] = useState<unknown>(null)
  if (doc !== loadedFor) {
    setLoadedFor(doc)
    setMarks([]); setSelected(null); setFound(null); setUsed({ terms: [], patterns: [] })
  }
  const startOver = () => { job.reset(); sel.clear() }

  const spansOf = useCallback(async (i: number) => {
    if (spans.current.doc !== doc) spans.current = { doc, map: new Map() }
    let s = spans.current.map.get(i)
    if (!s && doc) { s = await readSpans(doc as never, i); spans.current.map.set(i, s) }
    return s!
  }, [doc])

  const terms = () => query.split(/[\n,،]/).map((s) => s.trim()).filter(Boolean)
  const search = async () => {
    if (!doc || !pages) return
    const tt = terms()
    if (!tt.length && !patterns.length) return
    setSearching(true)
    try {
      let matches = 0
      const hitPages = new Set<number>()
      const add: Mark[] = []
      for (let i = 0; i < pages.length; i++) {
        const r = findOnPage(await spansOf(i), patterns, tt)
        matches += r.matches
        for (const b of r.boxes) {
          // Skip boxes already marked (searching twice doesn't double up).
          if (marks.some((m) => m.page === b.page && Math.abs(m.x - b.x) < 1 && Math.abs(m.y - b.y) < 1 && Math.abs(m.w - b.w) < 1)) continue
          add.push({ ...b, id: uid() })
          hitPages.add(i)
        }
        if (r.boxes.length) hitPages.add(i)
      }
      setMarks((m) => [...m, ...add])
      setUsed((u) => ({ terms: [...new Set([...u.terms, ...tt])], patterns: [...new Set([...u.patterns, ...patterns])] }))
      setFound({ matches, pages: hitPages.size })
    } finally {
      setSearching(false)
    }
  }

  const update = (id: string, patch: Partial<Mark>) => setMarks((l) => l.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  const remove = (id: string) => { setMarks((l) => l.filter((m) => m.id !== id)); setSelected(null) }

  // Drawing a new box: press on the page, drag, release.
  const startDraw = (e: ReactPointerEvent<HTMLDivElement>, page: number, k: number) => {
    if (e.target !== e.currentTarget || e.button !== 0) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    const x0 = (e.clientX - r.left) / k
    const y0 = (e.clientY - r.top) / k
    const id = uid()
    draft.current = { id, page, x0, y0 }
    setMarks((l) => [...l, { id, page, x: x0, y: y0, w: 0, h: 0 }])
    setSelected(id)
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const info = pages![page]
    const onMove = (ev: PointerEvent) => {
      const x1 = Math.max(0, Math.min(info.w, (ev.clientX - r.left) / k))
      const y1 = Math.max(0, Math.min(info.h, (ev.clientY - r.top) / k))
      update(id, { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) })
    }
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      draft.current = null
      // A click without a drag isn't a box.
      setMarks((l) => l.filter((m) => m.id !== id || (m.w >= 3 && m.h >= 3)))
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  const drag = (e: ReactPointerEvent, m: Mark, k: number, mode: 'move' | 'resize') => {
    e.preventDefault()
    e.stopPropagation()
    setSelected(m.id)
    const info = pages![m.page]
    const start = { x: e.clientX, y: e.clientY, m }
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / k
      const dy = (ev.clientY - start.y) / k
      if (mode === 'move') update(m.id, { x: Math.max(0, Math.min(info.w - m.w, start.m.x + dx)), y: Math.max(0, Math.min(info.h - m.h, start.m.y + dy)) })
      else update(m.id, { w: Math.max(3, Math.min(info.w - m.x, start.m.w + dx)), h: Math.max(3, Math.min(info.h - m.y, start.m.h + dy)) })
    }
    const onUp = () => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp) }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  const onMarkKey = (e: ReactKeyboardEvent, m: Mark) => {
    if (e.target !== e.currentTarget) return
    const info = pages![m.page]
    const step = e.shiftKey ? 10 : 1
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (move[e.key]) {
      e.preventDefault()
      const [dx, dy] = move[e.key]
      update(m.id, { x: Math.max(0, Math.min(info.w - m.w, m.x + dx)), y: Math.max(0, Math.min(info.h - m.h, m.y + dy)) })
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      remove(m.id)
    }
  }

  const markPage = (i: number) => {
    const info = pages![i]
    const id = uid()
    setMarks((l) => [...l, { id, page: i, x: 0, y: 0, w: info.w, h: info.h }])
    setSelected(id)
  }

  const run = () =>
    job.run(async ({ signal, progress }) => {
      if (!file || !doc || !pages) return []
      const byPage = [...new Set(marks.map((m) => m.page))].sort((a, b) => a - b)
      const out: RedactPage[] = []
      for (let k = 0; k < byPage.length; k++) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        const i = byPage[k]
        progress((k / byPage.length) * 0.7, { key: 'rd.working', params: { n: k + 1, count: byPage.length } })
        const info = pages[i]
        const boxes = marks.filter((m) => m.page === i)
        const { canvas } = await renderPage(doc, i + 1, DPI / 72)
        try {
          const g = canvas.getContext('2d')!
          const s = canvas.width / info.w
          g.fillStyle = '#000'
          for (const b of boxes) g.fillRect(Math.floor(b.x * s), Math.floor(b.y * s), Math.ceil(b.w * s) + 1, Math.ceil(b.h * s) + 1)
          const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.9)).arrayBuffer())
          const words = keepText ? keptWords(await spansOf(i), boxes, used.patterns, used.terms) : []
          out.push({ index: i, jpeg, width: info.w, height: info.h, words })
        } finally {
          releaseCanvas(canvas)
        }
      }
      progress(0.75, { key: 'rd.saving' })
      const bytes = await readBytes(file)
      const r = await runInWorker('redact', { file: { name: file.name, bytes }, options: { pages: out, sanitize } }, { signal })
      const note: OutputFile['note'] = { key: 'rd.note', params: { count: marks.length, pages: t('rd.pages', { count: r.pages }) } }
      return [{ name: deriveName(file.name, '-redacted', 'pdf'), blob: new Blob([r.bytes as BlobPart], { type: 'application/pdf' }), note }]
    })

  const renderMark = (m: Mark, k: number, info: PageInfo) => {
    const on = selected === m.id
    return (
      <div
        key={m.id}
        role="group"
        tabIndex={0}
        aria-label={t('rd.markLabel', { page: m.page + 1 })}
        onKeyDown={(e) => onMarkKey(e, m)}
        onFocus={() => setSelected(m.id)}
        onPointerDown={(e) => drag(e, m, k, 'move')}
        className={`absolute cursor-move touch-none bg-black/75 ${on ? 'outline outline-2 outline-offset-1 outline-accent' : 'outline outline-1 outline-danger/70'}`}
        style={{ left: pct(m.x, info.w), top: pct(m.y, info.h), width: pct(m.w, info.w), height: pct(m.h, info.h) }}
        data-testid="rd-mark"
      >
        {on && m.w > 0 && (
          <>
            <button type="button" aria-label={t('rd.removeMark')} onPointerDown={(e) => e.stopPropagation()} onClick={() => remove(m.id)} className="absolute -top-7 end-0 grid h-6 w-6 place-items-center rounded-full bg-danger text-white shadow" data-testid="rd-remove">
              <Icon name="x" size={14} />
            </button>
            <span aria-hidden="true" onPointerDown={(e) => drag(e, m, k, 'resize')} className="absolute -bottom-2 -end-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-accent shadow" />
          </>
        )}
      </div>
    )
  }

  const markedPages = new Set(marks.map((m) => m.page)).size
  return (
    <ToolFrame
      job={job}
      hasInput={!!file}
      rejections={sel.rejections}
      onDismissRejections={() => sel.setRejections([])}
      onStartOver={startOver}
      zipName={`${tool.slug}.zip`}
      dropzone={<Dropzone accept={ACCEPT} multiple={false} onFiles={sel.add} />}
      workspace={
        <Workspace
          main={
            <div className="space-y-3">
              <FileList files={sel.files} modifiesPdf onRemove={sel.remove} />
              {error && <Notice tone="error">{t(error.key, error.params)}</Notice>}
              {pages && <p className="text-sm text-muted">{t('rd.drawHint')}</p>}
              {pages && doc && (
                <div className="space-y-4">
                  {pages.map((info, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between text-sm text-muted">
                        <span>{t('rd.page', { n: i + 1, count: pages.length })}</span>
                        <Button size="sm" variant="ghost" onClick={() => markPage(i)} data-testid={`rd-whole-${i + 1}`}>{t('rd.wholePage')}</Button>
                      </div>
                      <PageView doc={doc} n={i} info={info} label={t('rd.page', { n: i + 1, count: pages.length })} onVisible={() => {}}>
                        {(k) => (
                          <div className="absolute inset-0 cursor-crosshair touch-none" onPointerDown={(e) => startDraw(e, i, k)} data-testid={`rd-surface-${i + 1}`}>
                            {marks.filter((m) => m.page === i).map((m) => renderMark(m, k, info))}
                          </div>
                        )}
                      </PageView>
                    </div>
                  ))}
                </div>
              )}
            </div>
          }
          side={
            <>
              <div className="space-y-2">
                <label htmlFor="rd-query" className="block font-semibold">{t('rd.find')}</label>
                <textarea id="rd-query" dir="auto" rows={2} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('rd.findPlaceholder')} className="w-full rounded-lg border border-line bg-surface px-3 py-2" data-testid="rd-query" />
                <fieldset className="space-y-1">
                  <legend className="mb-1 text-sm font-semibold">{t('rd.patterns')}</legend>
                  {PATTERNS.map((id) => (
                    <label key={id} className="flex min-h-9 cursor-pointer items-center gap-3">
                      <input type="checkbox" className="h-5 w-5" checked={patterns.includes(id)} onChange={(e) => setPatterns((p) => (e.target.checked ? [...p, id] : p.filter((x) => x !== id)))} data-testid={`rd-pattern-${id}`} />
                      {t(`rd.pattern.${id}`)}
                    </label>
                  ))}
                </fieldset>
                <Button className="w-full" icon="search" disabled={!pages || searching || (!query.trim() && !patterns.length)} onClick={search} data-testid="rd-search">{t('rd.findButton')}</Button>
                {found && (
                  <p role="status" className="text-sm" data-testid="rd-found">
                    {found.matches ? t('rd.found', { count: found.matches, pages: t('rd.pages', { count: found.pages }) }) : t('rd.notFound')}
                  </p>
                )}
              </div>
              {pages && (
                <div className="flex items-center justify-between gap-2 text-sm" data-testid="rd-summary">
                  <span>{t('rd.summary', { count: marks.length, pages: t('rd.pages', { count: markedPages }) })}</span>
                  {marks.length > 0 && <Button size="sm" variant="ghost" onClick={() => { setMarks([]); setSelected(null) }} data-testid="rd-clear">{t('rd.clear')}</Button>}
                </div>
              )}
              <label className="flex min-h-11 cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={keepText} onChange={(e) => setKeepText(e.target.checked)} data-testid="rd-keep-text" />
                <span><span className="font-semibold">{t('rd.keepText')}</span><br /><span className="text-sm text-muted">{t('rd.keepTextHint')}</span></span>
              </label>
              <label className="flex min-h-11 cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={sanitize} onChange={(e) => setSanitize(e.target.checked)} data-testid="rd-sanitize" />
                <span><span className="font-semibold">{t('rd.sanitize')}</span><br /><span className="text-sm text-muted">{t('rd.sanitizeHint')}</span></span>
              </label>
              <Button variant="primary" size="lg" icon="download" className="w-full" disabled={!marks.length} onClick={run} data-testid="run">
                {t('rd.run')}
              </Button>
              <Notice tone="info">{t('rd.how')}</Notice>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
