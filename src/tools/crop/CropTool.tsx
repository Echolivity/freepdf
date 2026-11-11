import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { PreviewDialog } from '../../components/PreviewDialog'
import { ToolFrame } from '../../components/ToolFrame'
import { PageThumb } from '../../components/thumbs'
import { Button, LocalBadge, Notice, Segmented, Workspace } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { readBytes, useFiles } from '../../components/useFiles'
import { useHistory } from '../../components/useHistory'
import { useJob } from '../../components/useJob'
import { usePdfDoc } from '../../components/usePdfDoc'
import { deriveName } from '../../lib/files'
import { downloadBlob, pdfBlob } from '../../lib/output'
import type { CropInsets, CropPage } from '../../lib/pdf/crop'
import { parsePageSet } from '../../lib/ranges'
import { UserFacingError, type FileKind } from '../../lib/validate'
import { runInWorker } from '../../lib/workerClient'
import { useI18n } from '../../i18n/context'
import type { Message } from '../../i18n/core'

const ACCEPT: FileKind[] = ['pdf']
const MM = 72 / 25.4
const MIN = 36
const ZERO: CropInsets = { top: 0, right: 0, bottom: 0, left: 0 }
type Scope = 'all' | 'selected' | 'each'
type Side = keyof CropInsets
interface State {
  /** Crop shared by "all" and "selected". */
  shared: CropInsets
  /** Per-page crops for "each" (0-based page → insets). */
  each: Record<number, CropInsets>
}
const INITIAL: State = { shared: ZERO, each: {} }
const fieldCls = 'h-10 w-full rounded-lg border border-line-strong bg-paper px-2 text-center tabular-nums focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15'

/** Visible size of each page in points (rotation applied), read with PDF.js. */
function usePageSizes(doc: ReturnType<typeof usePdfDoc>['doc']) {
  const [sizes, setSizes] = useState<{ doc: unknown; list: { w: number; h: number }[] } | null>(null)
  useEffect(() => {
    if (!doc) return
    let dead = false
    ;(async () => {
      const list: { w: number; h: number }[] = []
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i)
        const vp = p.getViewport({ scale: 1 })
        list.push({ w: vp.width, h: vp.height })
        if (dead) return
      }
      if (!dead) setSizes({ doc, list })
    })().catch(() => {})
    return () => { dead = true }
  }, [doc])
  return sizes?.doc === doc ? sizes.list : null
}

export default function CropTool() {
  const { t, tm } = useI18n()
  const sel = useFiles(ACCEPT, { multiple: false })
  const file = sel.files[0] ?? null
  const { doc, error: docError, loading } = usePdfDoc(file)
  const sizes = usePageSizes(doc)
  const job = useJob()
  const history = useHistory<State>(INITIAL)
  const state = history.value
  const [scope, setScope] = useState<Scope>('all')
  const [current, setCurrent] = useState(0)
  const [rangeText, setRangeText] = useState('')
  const [preview, setPreview] = useState<Uint8Array | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Message | null>(null)
  const count = doc?.numPages ?? 0

  const [stateFor, setStateFor] = useState(file)
  if (stateFor !== file) {
    setStateFor(file)
    history.replace(INITIAL)
    setCurrent(0)
    setRangeText('')
  }

  const range = useMemo((): { indices: number[]; error: Message | null } => {
    if (scope !== 'selected') return { indices: [], error: null }
    if (!rangeText.trim()) return { indices: [], error: { key: 'crop.needPages' } }
    try {
      return { indices: parsePageSet(rangeText, count), error: null }
    } catch (e) {
      return { indices: [], error: e instanceof UserFacingError ? e.toMessage() : { key: 'rng.empty' } }
    }
  }, [scope, rangeText, count])

  const inset = scope === 'each' ? (state.each[current] ?? ZERO) : state.shared
  const size = sizes?.[current]
  const setInset = (next: CropInsets) => history.set((s: State): State => (scope === 'each' ? { ...s, each: { ...s.each, [current]: next } } : { ...s, shared: next }))

  /** The crop per page that will be applied. */
  const plan = useMemo((): CropPage[] => {
    if (scope === 'each') return Object.entries(state.each).map(([i, v]) => ({ index: Number(i), inset: v }))
    const idx = scope === 'all' ? Array.from({ length: count }, (_, i) => i) : range.indices
    return idx.map((index) => ({ index, inset: state.shared }))
  }, [scope, state, count, range.indices])
  const effective = plan.filter((p) => p.inset.top || p.inset.right || p.inset.bottom || p.inset.left)

  // A crop that leaves less than ½ inch on any targeted page.
  const tooSmall = sizes ? effective.find((p) => { const s = sizes[p.index]; return s && (s.w - p.inset.left - p.inset.right < MIN || s.h - p.inset.top - p.inset.bottom < MIN) }) : undefined
  const invalid = !effective.length || !!range.error || !!tooSmall

  const result = async (signal?: AbortSignal) => {
    const bytes = await readBytes(file!)
    return runInWorker('crop', { file: { name: file!.name, bytes }, pages: effective }, { signal })
  }
  const run = () =>
    job.run(async ({ signal }) => {
      if (!file) return []
      const out = await result(signal)
      return [{ name: deriveName(file.name, '-cropped', 'pdf'), blob: pdfBlob(out), note: { key: 'note.cropped', params: { count: effective.length } } }]
    })
  const showPreview = async () => {
    setBusy(true)
    setError(null)
    try { setPreview(await result()) } catch (e) { setError(e instanceof UserFacingError ? e.toMessage() : { key: 'err.generic' }) } finally { setBusy(false) }
  }

  const startOver = () => { job.reset(); sel.clear() }
  const mm = (pt: number) => String(Math.round((pt / MM) * 10) / 10)
  const sides: Side[] = ['top', 'right', 'bottom', 'left']

  return (
    <ToolFrame
      job={job}
      hasInput={!!file}
      rejections={sel.rejections}
      onDismissRejections={() => sel.setRejections([])}
      onStartOver={startOver}
      dropzone={<Dropzone accept={ACCEPT} multiple={false} onFiles={sel.add} />}
      workspace={
        <Workspace
          main={
            <div className="space-y-4">
              {file && <FileList files={[file]} onRemove={startOver} extra={() => (count ? t('files.pages', { count }) : '')} />}
              {docError && <Notice tone="error">{tm(docError)}</Notice>}
              {loading && <p className="text-muted" role="status">{t('common.readingPages')}</p>}
              {doc && size && (
                <div className="rounded-2xl border border-line bg-surface p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0} aria-label={t('cpr.prev')}>
                      <Icon name="arrowLeft" size={18} className="rtl:-scale-x-100" />
                    </Button>
                    <span className="text-sm font-semibold tabular-nums" data-testid="crop-page">{t('cpr.pageOf', { page: current + 1, total: count })}</span>
                    <Button size="sm" variant="ghost" onClick={() => setCurrent((c) => Math.min(count - 1, c + 1))} disabled={current >= count - 1} aria-label={t('cpr.next')}>
                      <Icon name="arrowLeft" size={18} className="-scale-x-100 rtl:scale-x-100" />
                    </Button>
                  </div>
                  <CropCanvas
                    key={current}
                    doc={doc}
                    page={current}
                    width={size.w}
                    height={size.h}
                    inset={inset}
                    active={scope !== 'selected' || range.indices.includes(current)}
                    onChange={setInset}
                    label={t('crop.area', { page: current + 1 })}
                  />
                  <p className="mt-2 text-center text-sm text-muted" data-testid="crop-size">
                    {t('crop.result', { w: mm(size.w - inset.left - inset.right), h: mm(size.h - inset.top - inset.bottom) })}
                  </p>
                </div>
              )}
              {preview && file && (
                <PreviewDialog bytes={preview} title={t('preview.titleCrop')} onClose={() => setPreview(null)} onDownload={() => downloadBlob(pdfBlob(preview), deriveName(file.name, '-cropped', 'pdf'))} />
              )}
            </div>
          }
          side={
            <>
              <Segmented<Scope>
                label={t('crop.scope')}
                value={scope}
                onChange={setScope}
                options={[
                  { value: 'all', label: t('crop.scope.all') },
                  { value: 'selected', label: t('crop.scope.selected') },
                  { value: 'each', label: t('crop.scope.each'), hint: t('crop.scope.eachHint') },
                ]}
              />
              {scope === 'selected' && (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">{t('crop.pages')}</span>
                  <input value={rangeText} onChange={(e) => setRangeText(e.target.value)} placeholder={t('select.placeholder')} dir="ltr" inputMode="numeric" className={`${fieldCls} h-11 text-start`} data-testid="ranges" />
                </label>
              )}
              <fieldset>
                <legend className="mb-1.5 text-sm font-semibold">{t('crop.margins')}</legend>
                <div className="grid grid-cols-2 gap-2">
                  {sides.map((side) => (
                    <label key={side} className="block">
                      <span className="mb-0.5 block text-xs font-semibold text-muted">{t(`crop.${side}`)}</span>
                      <input
                        value={mm(inset[side])}
                        onChange={(e) => {
                          const v = Number(e.target.value.replace(',', '.'))
                          if (Number.isFinite(v) && v >= 0) setInset({ ...inset, [side]: v * MM })
                        }}
                        inputMode="decimal"
                        dir="ltr"
                        className={fieldCls}
                        data-testid={`crop-${side}`}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" icon="undo" onClick={history.undo} disabled={!history.canUndo} data-testid="undo">{t('history.undo')}</Button>
                <Button size="sm" variant="ghost" icon="redo" onClick={history.redo} disabled={!history.canRedo}>{t('history.redo')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setInset(ZERO)} disabled={!inset.top && !inset.right && !inset.bottom && !inset.left}>{t('crop.reset')}</Button>
              </div>
              {range.error && rangeText.trim() && <p className="text-sm font-semibold text-danger" role="alert">{tm(range.error)}</p>}
              {tooSmall && <p className="text-sm font-semibold text-danger" role="alert">{t('err.cropTooSmall', { page: tooSmall.index + 1 })}</p>}
              {error && <p className="text-sm font-semibold text-danger" role="alert">{tm(error)}</p>}
              {effective.length > 0 && !tooSmall && <p className="text-sm text-muted" data-testid="crop-summary">{t('crop.summary', { count: effective.length })}</p>}
              <Notice tone="info">{t('crop.notRedaction')}</Notice>
              <Button icon="eye" className="w-full" disabled={invalid || busy} onClick={showPreview} data-testid="preview">{busy ? t('preview.building') : t('preview.open')}</Button>
              <Button variant="primary" size="lg" icon="crop" className="w-full" disabled={invalid} onClick={run} data-testid="run">{t('crop.run')}</Button>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}

type Handle = Side | 'tl' | 'tr' | 'bl' | 'br' | 'move'

/**
 * The page with a draggable crop rectangle. Edges and corners resize, the middle moves the box; works
 * with mouse, pen and touch (pointer events), and with the keyboard (arrow keys on a focused handle,
 * Shift for bigger steps). Values are in points, in the page's visual orientation.
 */
function CropCanvas({ doc, page, width, height, inset, onChange, active, label }: {
  doc: NonNullable<ReturnType<typeof usePdfDoc>['doc']>
  page: number
  width: number
  height: number
  inset: CropInsets
  onChange: (v: CropInsets) => void
  active: boolean
  label: string
}) {
  const { t } = useI18n()
  const host = useRef<HTMLDivElement>(null)
  const drag = useRef<{ handle: Handle; x: number; y: number; start: CropInsets } | null>(null)
  // While dragging, the box follows the pointer locally; one undo step is recorded on release.
  const [live, setLive] = useState<CropInsets | null>(null)

  const clamp = (v: CropInsets): CropInsets => {
    const c = { ...v }
    for (const k of ['top', 'right', 'bottom', 'left'] as Side[]) c[k] = Math.max(0, c[k])
    if (c.left + c.right > width - MIN) { if (drag.current?.handle === 'move') return v; c.left = Math.min(c.left, width - MIN - c.right) }
    if (c.top + c.bottom > height - MIN) { c.top = Math.min(c.top, height - MIN - c.bottom) }
    return c
  }
  const apply = (h: Handle, s: CropInsets, dx: number, dy: number): CropInsets => {
    const v = { ...s }
    if (h === 'move') {
      const mx = Math.max(-s.left, Math.min(s.right, dx))
      const my = Math.max(-s.top, Math.min(s.bottom, dy))
      return { left: s.left + mx, right: s.right - mx, top: s.top + my, bottom: s.bottom - my }
    }
    if (h === 'left' || h === 'tl' || h === 'bl') v.left = s.left + dx
    if (h === 'right' || h === 'tr' || h === 'br') v.right = s.right - dx
    if (h === 'top' || h === 'tl' || h === 'tr') v.top = s.top + dy
    if (h === 'bottom' || h === 'bl' || h === 'br') v.bottom = s.bottom - dy
    return clamp(v)
  }
  const down = (h: Handle) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic or already-released pointer */ }
    drag.current = { handle: h, x: e.clientX, y: e.clientY, start: inset }
  }
  const move = (e: ReactPointerEvent) => {
    const d = drag.current
    const el = host.current
    if (!d || !el) return
    const r = el.getBoundingClientRect()
    const k = width / r.width
    setLive(apply(d.handle, d.start, (e.clientX - d.x) * k, (e.clientY - d.y) * k))
  }
  const up = () => {
    if (!drag.current) return
    drag.current = null
    if (live) onChange(live)
    setLive(null)
  }
  const key = (h: Handle) => (e: ReactKeyboardEvent) => {
    const step = e.shiftKey ? 10 * MM : MM
    const dir: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const d = dir[e.key]
    if (!d) return
    e.preventDefault()
    onChange(apply(h, inset, d[0], d[1]))
  }

  const pct = (v: number, of: number) => `${(100 * v) / of}%`
  const shown = live ?? inset
  const box = { left: pct(shown.left, width), right: pct(shown.right, width), top: pct(shown.top, height), bottom: pct(shown.bottom, height) }
  const handles: { h: Handle; cls: string; name: string }[] = [
    { h: 'top', cls: 'left-1/2 top-0 h-3 w-10 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize', name: t('crop.top') },
    { h: 'bottom', cls: 'bottom-0 left-1/2 h-3 w-10 -translate-x-1/2 translate-y-1/2 cursor-ns-resize', name: t('crop.bottom') },
    { h: 'left', cls: 'left-0 top-1/2 h-10 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize', name: t('crop.left') },
    { h: 'right', cls: 'right-0 top-1/2 h-10 w-3 -translate-y-1/2 translate-x-1/2 cursor-ew-resize', name: t('crop.right') },
    { h: 'tl', cls: 'left-0 top-0 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize', name: t('crop.corner') },
    { h: 'tr', cls: 'right-0 top-0 h-4 w-4 -translate-y-1/2 translate-x-1/2 cursor-nesw-resize', name: t('crop.corner') },
    { h: 'bl', cls: 'bottom-0 left-0 h-4 w-4 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize', name: t('crop.corner') },
    { h: 'br', cls: 'bottom-0 right-0 h-4 w-4 translate-x-1/2 translate-y-1/2 cursor-nwse-resize', name: t('crop.corner') },
  ]
  return (
    // Crop coordinates are physical page sides, so this stays left-to-right in Arabic too.
    <div dir="ltr" className="mx-auto max-w-md">
      <div ref={host} className="relative touch-none select-none" role="group" aria-label={label} data-testid="crop-canvas">
        <PageThumb doc={doc} pageNumber={page + 1} width={448} />
        <div className={`absolute inset-0 ${active ? '' : 'opacity-40'}`}>
          {/* Dimmed area outside the crop */}
          <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/45" style={{ height: box.top }} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/45" style={{ height: box.bottom }} />
          <div className="pointer-events-none absolute bg-black/45" style={{ top: box.top, bottom: box.bottom, left: 0, width: box.left }} />
          <div className="pointer-events-none absolute bg-black/45" style={{ top: box.top, bottom: box.bottom, right: 0, width: box.right }} />
          <div
            className="absolute cursor-move border-2 border-accent"
            style={{ left: box.left, right: box.right, top: box.top, bottom: box.bottom }}
            onPointerDown={down('move')}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={() => { drag.current = null; setLive(null) }}
            data-testid="crop-box"
          >
            {handles.map(({ h, cls, name }) => (
              <button
                key={h}
                type="button"
                aria-label={name}
                className={`absolute rounded-sm border-2 border-accent bg-surface shadow ${cls}`}
                onPointerDown={down(h)}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={() => { drag.current = null; setLive(null) }}
                onKeyDown={key(h)}
                data-testid={`crop-handle-${h}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
