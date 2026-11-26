import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { ToolFrame } from '../../components/ToolFrame'
import { Button, LocalBadge, Notice, Segmented, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useJob } from '../../components/useJob'
import { usePdfDoc } from '../../components/usePdfDoc'
import { Icon } from '../../components/Icon'
import type { ToolDef } from '../registry'
import { deriveName } from '../../lib/files'
import type { PDFDocumentProxy } from '../../lib/render/pdfjs'
import { PageView, type PageInfo } from '../../components/PageView'
import { runInWorker } from '../../lib/workerClient'
import type { FieldValue, PlacedItem } from '../../lib/pdf/fillSign'
import type { FileKind } from '../../lib/validate'
import type { OutputFile } from '../../lib/output'
import { useI18n } from '../../i18n/context'
import { SignatureDialog, type Signature } from './SignatureDialog'

const ACCEPT: FileKind[] = ['pdf']

/** A form field widget on a page, in points from the displayed page's top-left corner. */
interface Field {
  id: string
  name: string
  kind: 'text' | 'check' | 'radio' | 'choice'
  page: number
  x: number
  y: number
  w: number
  h: number
  label: string
  multiline?: boolean
  maxLen?: number
  comb?: boolean
  readOnly?: boolean
  /** Checkbox / radio button: the value this widget stands for. */
  onValue?: string
  options?: { value: string; label: string }[]
  multiSelect?: boolean
}
type Value = string | boolean | string[]


/** Something added on a page; position and size in points of the displayed page. */
interface Item {
  id: string
  page: number
  kind: 'text' | 'date' | 'check' | 'cross' | 'signature' | 'initials'
  x: number
  y: number
  w: number
  h: number
  text?: string
  size?: number
  sig?: Signature
}

let seq = 0
const uid = () => `i${++seq}`

/** Pages (displayed size and coordinate mapping) and form fields, read with PDF.js. */
function useForm(doc: PDFDocumentProxy | null) {
  const [state, setState] = useState<{ doc: unknown; pages: PageInfo[]; fields: Field[]; initial: Record<string, Value>; xfa: boolean } | null>(null)
  useEffect(() => {
    if (!doc) return
    let dead = false
    ;(async () => {
      const pages: PageInfo[] = []
      const fields: Field[] = []
      const initial: Record<string, Value> = {}
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i)
        const vp = page.getViewport({ scale: 1 })
        pages.push({ w: vp.width, h: vp.height, toPdf: (x, y) => vp.convertToPdfPoint(x, y) as [number, number] })
        const annots = await page.getAnnotations({ intent: 'display' })
        for (const a of annots) {
          if (a.subtype !== 'Widget' || !a.fieldName || a.hidden || a.fieldType === 'Sig' || a.pushButton) continue
          // Both corners of the widget rectangle, mapped onto the displayed (rotated, cropped) page.
          const [x1, y1] = vp.convertToViewportPoint(a.rect[0], a.rect[1])
          const [x2, y2] = vp.convertToViewportPoint(a.rect[2], a.rect[3])
          const box = { page: i - 1, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
          const base = { id: String(a.id), name: String(a.fieldName), label: String(a.alternativeText || a.fieldName), readOnly: !!a.readOnly, ...box }
          if (a.fieldType === 'Tx') {
            fields.push({ ...base, kind: 'text', multiline: !!a.multiLine, maxLen: a.maxLen || undefined, comb: !!a.comb })
            initial[base.name] ??= typeof a.fieldValue === 'string' ? a.fieldValue : ''
          } else if (a.fieldType === 'Btn' && a.checkBox) {
            fields.push({ ...base, kind: 'check', onValue: String(a.exportValue ?? 'Yes') })
            initial[base.name] ??= !!a.fieldValue && a.fieldValue !== 'Off'
          } else if (a.fieldType === 'Btn' && a.radioButton) {
            fields.push({ ...base, kind: 'radio', onValue: String(a.buttonValue) })
            if (a.fieldValue && a.fieldValue !== 'Off') initial[base.name] = String(a.fieldValue)
            else initial[base.name] ??= ''
          } else if (a.fieldType === 'Ch') {
            const options = ((a.options ?? []) as { exportValue: string; displayValue: string }[]).map((o) => ({ value: String(o.displayValue ?? o.exportValue), label: String(o.displayValue ?? o.exportValue) }))
            fields.push({ ...base, kind: 'choice', options, multiSelect: !!a.multiSelect })
            const v = a.fieldValue
            initial[base.name] ??= Array.isArray(v) ? v.map(String) : v ? [String(v)] : []
          }
        }
        page.cleanup()
        if (dead) return
      }
      if (!dead) setState({ doc, pages, fields, initial, xfa: !!(doc as unknown as { isPureXfa?: boolean }).isPureXfa })
    })().catch(() => { if (!dead) setState({ doc, pages: [], fields: [], initial: {}, xfa: false }) })
    return () => { dead = true }
  }, [doc])
  return state?.doc === doc ? state : null
}

const pct = (v: number, of: number) => `${(v / of) * 100}%`
const today = () => {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

/**
 * Fill & Sign: fill a PDF's form fields in place, and add text, dates, ticks, crosses and signatures
 * anywhere on its pages (flat or scanned forms too). Everything stays in the browser.
 */
export default function FillSignTool({ tool }: { tool: ToolDef }) {
  const { t } = useI18n()
  const sel = useFiles(ACCEPT, { multiple: false })
  const job = useJob()
  const file = sel.files[0] ?? null
  const { doc, error } = usePdfDoc(file)
  const form = useForm(doc)
  const [values, setValues] = useState<Record<string, Value>>({})
  const [items, setItems] = useState<Item[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [flatten, setFlatten] = useState(false)
  const [sigOpen, setSigOpen] = useState<'signature' | 'initials' | null>(null)
  const [signature, setSignature] = useState<Signature | null>(null)
  const [initials, setInitials] = useState<Signature | null>(null)
  const visible = useRef(0)
  const onVisible = useCallback((n: number) => { visible.current = n }, [])
  const startOver = () => { job.reset(); sel.clear(); setValues({}); setItems([]); setSelected(null) }

  // Answers start from what the form already holds; reset when a different file is opened.
  const formKey = form ? form.doc : null
  const [loadedFor, setLoadedFor] = useState<unknown>(null)
  if (form && loadedFor !== formKey) { setLoadedFor(formKey); setValues(form.initial); setItems([]); setSelected(null) }

  const fieldsByPage = useMemo(() => {
    const m = new Map<number, Field[]>()
    for (const f of form?.fields ?? []) m.set(f.page, [...(m.get(f.page) ?? []), f])
    return m
  }, [form])

  const add = (kind: Item['kind'], sig?: Signature) => {
    if (!form?.pages.length) return
    const page = Math.min(visible.current, form.pages.length - 1)
    const p = form.pages[page]
    const size = 12
    const dims: Record<Item['kind'], [number, number]> = { text: [180, size * 1.6], date: [90, size * 1.6], check: [16, 16], cross: [16, 16], signature: [150, sig ? (150 * sig.height) / sig.width : 50], initials: [50, sig ? (50 * sig.height) / sig.width : 25] }
    const [w, h] = dims[kind]
    const item: Item = { id: uid(), page, kind, x: (p.w - w) / 2, y: Math.min(p.h - h, p.h * 0.45), w, h, size, ...(kind === 'date' ? { text: today() } : kind === 'text' ? { text: '' } : {}), ...(sig ? { sig } : {}) }
    setItems((l) => [...l, item])
    setSelected(item.id)
  }
  /** Copies of an item on every other page, at the same place relative to each page's size. */
  const copyToEveryPage = (it: Item) => {
    if (!form) return
    const from = form.pages[it.page]
    const copies = form.pages.flatMap((p, page): Item[] => {
      if (page === it.page) return []
      const x = Math.max(0, Math.min(p.w - it.w, (it.x / from.w) * p.w))
      const y = Math.max(0, Math.min(p.h - it.h, (it.y / from.h) * p.h))
      return [{ ...it, id: uid(), page, x, y }]
    })
    setItems((l) => [...l, ...copies])
  }
  /** Initials: one in the bottom-right corner of every page, each movable on its own. */
  const addInitials = (sig: Signature) => {
    if (!form) return
    const w = 50
    const h = (w * sig.height) / sig.width
    const list = form.pages.map((p, page): Item => ({ id: uid(), page, kind: 'initials', x: Math.max(0, p.w - w - 36), y: Math.max(0, p.h - h - 36), w, h, sig }))
    setItems((l) => [...l, ...list])
    setSelected(list[0]?.id ?? null)
  }
  const update = (id: string, patch: Partial<Item>) => setItems((l) => l.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  const remove = (id: string) => { setItems((l) => l.filter((i) => i.id !== id)); setSelected(null) }

  const changedFields = (): FieldValue[] => {
    if (!form) return []
    const out: FieldValue[] = []
    const seen = new Set<string>()
    for (const f of form.fields) {
      if (seen.has(f.name) || f.readOnly) continue
      seen.add(f.name)
      const v = values[f.name]
      const was = form.initial[f.name]
      if (JSON.stringify(v) === JSON.stringify(was)) continue
      if (f.kind === 'text') out.push({ name: f.name, kind: 'text', value: String(v ?? '') })
      else if (f.kind === 'check') out.push({ name: f.name, kind: 'check', value: !!v })
      else if (f.kind === 'radio') out.push({ name: f.name, kind: 'radio', value: String(v ?? '') })
      else out.push({ name: f.name, kind: 'choice', value: Array.isArray(v) ? v : v ? [String(v)] : [] })
    }
    return out
  }

  const placed = (): PlacedItem[] => {
    if (!form) return []
    return items.flatMap((it): PlacedItem[] => {
      const p = form.pages[it.page]
      if (!p) return []
      // Bottom edge of the item on the displayed page → user space; its direction gives the angle.
      const [ax, ay] = p.toPdf(it.x, it.y + it.h)
      const [bx, by] = p.toPdf(it.x + it.w, it.y + it.h)
      const angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI
      const base = { page: it.page, x: ax, y: ay, w: it.w, h: it.h, angle }
      if (it.kind === 'text' || it.kind === 'date') return it.text?.trim() ? [{ ...base, kind: 'text', text: it.text, size: it.size ?? 12 }] : []
      if (it.kind === 'check' || it.kind === 'cross') return [{ ...base, kind: 'mark', mark: it.kind }]
      return it.sig ? [{ ...base, kind: 'image', png: it.sig.png }] : []
    })
  }

  const save = () =>
    job.run(async ({ signal, progress }) => {
      if (!file) return []
      progress(0.1, { key: 'fs.working' })
      const fields = changedFields()
      const list = placed()
      const r = await runInWorker('fillSign', { file: { name: file.name, bytes: await readBytes(file) }, options: { fields, items: list, flatten } }, { signal })
      const suffix = tool.slug === 'sign-pdf' ? '-signed' : '-filled'
      const note: OutputFile['note'] = r.skipped.length
        ? { key: 'fs.noteSkipped', params: { count: fields.length - r.skipped.length, fields: fields.length - r.skipped.length, items: list.length, skipped: r.skipped.length } }
        : { key: 'fs.note', params: { count: fields.length, fields: fields.length, items: list.length } }
      return [{
        name: deriveName(file.name, suffix, 'pdf'),
        blob: new Blob([r.bytes as BlobPart], { type: 'application/pdf' }),
        note,
      }]
    })

  const nothing = !changedFields().length && !placed().length
  const set = (name: string, v: Value) => setValues((s) => ({ ...s, [name]: v }))

  const renderField = (f: Field, k: number, info: PageInfo) => {
    const style = { left: pct(f.x, info.w), top: pct(f.y, info.h), width: pct(f.w, info.w), height: pct(f.h, info.h), fontSize: `${Math.max(9, Math.min(f.h * 0.62, 14) * k)}px` }
    const common = 'absolute rounded-[3px] bg-accent/10 text-[#111827] outline-none ring-1 ring-accent/40 focus:bg-white focus:ring-2 focus:ring-accent disabled:opacity-60'
    const v = values[f.name]
    if (f.kind === 'text') {
      const props = { 'aria-label': f.label, dir: 'auto' as const, disabled: f.readOnly, maxLength: f.maxLen, value: String(v ?? ''), 'data-field': f.name }
      return f.multiline
        ? <textarea key={f.id} {...props} className={`${common} resize-none px-1 leading-tight`} style={style} onChange={(e) => set(f.name, e.target.value)} />
        : <input key={f.id} {...props} className={`${common} px-1 ${f.comb ? 'tracking-[0.5em]' : ''}`} style={style} onChange={(e) => set(f.name, e.target.value)} />
    }
    if (f.kind === 'check' || f.kind === 'radio') {
      const checked = f.kind === 'check' ? !!v : v === f.onValue
      return (
        <input
          key={f.id}
          type={f.kind === 'check' ? 'checkbox' : 'radio'}
          name={f.kind === 'radio' ? `fs-${f.name}` : undefined}
          aria-label={f.kind === 'radio' ? `${f.label}: ${f.onValue}` : f.label}
          checked={checked}
          disabled={f.readOnly}
          onChange={(e) => set(f.name, f.kind === 'check' ? e.target.checked : f.onValue ?? '')}
          className="absolute m-0 cursor-pointer accent-[var(--accent)]"
          style={{ left: pct(f.x, info.w), top: pct(f.y, info.h), width: pct(f.w, info.w), height: pct(f.h, info.h) }}
          data-field={f.name}
        />
      )
    }
    const list = Array.isArray(v) ? v : []
    return (
      <select
        key={f.id}
        aria-label={f.label}
        dir="auto"
        disabled={f.readOnly}
        multiple={f.multiSelect}
        value={f.multiSelect ? list : list[0] ?? ''}
        onChange={(e) => set(f.name, f.multiSelect ? [...e.target.selectedOptions].map((o) => o.value) : e.target.value ? [e.target.value] : [])}
        className={`${common} px-1`}
        style={style}
        data-field={f.name}
      >
        {!f.multiSelect && <option value="">—</option>}
        {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  }

  const drag = (e: ReactPointerEvent, it: Item, k: number, mode: 'move' | 'resize') => {
    e.preventDefault()
    e.stopPropagation()
    setSelected(it.id)
    const info = form!.pages[it.page]
    const start = { x: e.clientX, y: e.clientY, it }
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / k
      const dy = (ev.clientY - start.y) / k
      if (mode === 'move') {
        update(it.id, { x: Math.max(0, Math.min(info.w - it.w, start.it.x + dx)), y: Math.max(0, Math.min(info.h - it.h, start.it.y + dy)) })
      } else {
        const w = Math.max(10, Math.min(info.w - it.x, start.it.w + dx))
        const ratio = w / start.it.w
        // Signatures and marks keep their shape; text boxes grow with their type size.
        const h = Math.min(info.h - it.y, start.it.h * ratio)
        update(it.id, { w, h, ...(it.kind === 'text' || it.kind === 'date' ? { size: Math.max(6, Math.min(72, (start.it.size ?? 12) * ratio)) } : {}) })
      }
    }
    const onUp = () => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp) }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  const onItemKey = (e: ReactKeyboardEvent, it: Item) => {
    if (e.target !== e.currentTarget) return
    const step = e.shiftKey ? 10 : 1
    const info = form!.pages[it.page]
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (move[e.key]) {
      e.preventDefault()
      const [dx, dy] = move[e.key]
      update(it.id, { x: Math.max(0, Math.min(info.w - it.w, it.x + dx)), y: Math.max(0, Math.min(info.h - it.h, it.y + dy)) })
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      remove(it.id)
    }
  }

  const itemLabel = (it: Item) => t(`fs.item.${it.kind}`)
  const renderItem = (it: Item, k: number, info: PageInfo) => {
    const on = selected === it.id
    return (
      <div
        key={it.id}
        role="group"
        tabIndex={0}
        aria-label={t('fs.itemLabel', { item: itemLabel(it), page: it.page + 1 })}
        onKeyDown={(e) => onItemKey(e, it)}
        onFocus={() => setSelected(it.id)}
        onPointerDown={(e) => { if ((e.target as HTMLElement).dataset.handle === 'move' || it.kind === 'check' || it.kind === 'cross' || it.kind === 'signature' || it.kind === 'initials') drag(e, it, k, 'move') }}
        className={`absolute touch-none select-none ${on ? 'ring-2 ring-accent' : 'ring-1 ring-accent/30 hover:ring-accent/60'} ${it.kind === 'text' || it.kind === 'date' ? '' : 'cursor-move'}`}
        style={{ left: pct(it.x, info.w), top: pct(it.y, info.h), width: pct(it.w, info.w), height: pct(it.h, info.h) }}
        data-testid={`fs-item-${it.kind}`}
      >
        {(it.kind === 'text' || it.kind === 'date') && (
          <>
            <textarea
              dir="auto"
              aria-label={itemLabel(it)}
              value={it.text ?? ''}
              placeholder={t('fs.typeHere')}
              onChange={(e) => update(it.id, { text: e.target.value, h: Math.max(it.h, (e.target.value.split('\n').length) * (it.size ?? 12) * 1.25 + 4) })}
              className="block h-full w-full resize-none overflow-hidden bg-transparent p-0 leading-[1.2] text-[#111827] outline-none placeholder:text-[#111827]/40"
              style={{ fontSize: `${(it.size ?? 12) * k}px`, fontFamily: '"IBM Plex Sans Arabic", system-ui, sans-serif' }}
              data-testid="fs-item-text"
            />
            <span data-handle="move" aria-hidden="true" className="absolute -top-7 start-0 grid h-6 w-6 cursor-move place-items-center rounded-full bg-accent text-on-accent shadow">
              <Icon name="grip" size={14} />
            </span>
          </>
        )}
        {(it.kind === 'check' || it.kind === 'cross') && (
          <svg viewBox="0 0 16 16" className="h-full w-full" aria-hidden="true">
            {it.kind === 'check' ? <path d="M1.9 8 6.4 12.9 14.4 2.4" fill="none" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> : <path d="M2.4 2.4l11.2 11.2M13.6 2.4 2.4 13.6" fill="none" stroke="#111827" strokeWidth="2" strokeLinecap="round" />}
          </svg>
        )}
        {(it.kind === 'signature' || it.kind === 'initials') && it.sig && <img src={it.sig.url} alt="" className="pointer-events-none h-full w-full" draggable={false} />}
        {on && (
          <>
            <button type="button" aria-label={t('fs.remove', { item: itemLabel(it) })} onPointerDown={(e) => e.stopPropagation()} onClick={() => remove(it.id)} className="absolute -top-7 end-0 grid h-6 w-6 place-items-center rounded-full bg-danger text-white shadow" data-testid="fs-item-remove">
              <Icon name="x" size={14} />
            </button>
            {(form?.pages.length ?? 0) > 1 && (
              <button type="button" aria-label={t('fs.everyPage', { item: itemLabel(it) })} title={t('fs.everyPage', { item: itemLabel(it) })} onPointerDown={(e) => e.stopPropagation()} onClick={() => copyToEveryPage(it)} className="absolute -top-7 end-7 grid h-6 w-6 place-items-center rounded-full bg-accent text-on-accent shadow" data-testid="fs-item-every-page">
                <Icon name="copy" size={14} />
              </button>
            )}
            <span aria-hidden="true" onPointerDown={(e) => drag(e, it, k, 'resize')} className="absolute -bottom-2 -end-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-accent shadow" data-testid="fs-item-resize" />
          </>
        )}
      </div>
    )
  }

  const fieldCount = new Set(form?.fields.map((f) => f.name)).size
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
              {form?.xfa && <Notice tone="info">{t('fs.xfa')}</Notice>}
              {form && (
                <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/95 p-2 shadow-card backdrop-blur" role="toolbar" aria-label={t('fs.toolbar')}>
                  <Button size="sm" icon="type" onClick={() => add('text')} data-testid="fs-add-text">{t('fs.addText')}</Button>
                  <Button size="sm" icon="calendar" onClick={() => add('date')} data-testid="fs-add-date">{t('fs.addDate')}</Button>
                  <Button size="sm" onClick={() => add('check')} aria-label={t('fs.addCheck')} data-testid="fs-add-check">✓</Button>
                  <Button size="sm" onClick={() => add('cross')} aria-label={t('fs.addCross')} data-testid="fs-add-cross">✗</Button>
                  <Button size="sm" variant={tool.slug === 'sign-pdf' ? 'primary' : 'secondary'} icon="signature" onClick={() => (signature ? add('signature', signature) : setSigOpen('signature'))} data-testid="fs-add-signature">{t('fs.addSignature')}</Button>
                  <Button size="sm" icon="signature" onClick={() => (initials ? addInitials(initials) : setSigOpen('initials'))} data-testid="fs-add-initials">{t('fs.addInitials')}</Button>
                  {(signature || initials) && <Button size="sm" variant="ghost" onClick={() => setSigOpen(signature ? 'signature' : 'initials')} data-testid="fs-new-signature">{t(signature ? 'fs.newSignature' : 'fs.newInitials')}</Button>}
                </div>
              )}
              {form && doc && (
                <div className="space-y-4" onPointerDown={(e) => { if (e.target === e.currentTarget) setSelected(null) }}>
                  {form.pages.map((info, i) => (
                    <PageView key={i} doc={doc} n={i} info={info} label={t('fs.pageLabel', { n: i + 1, count: form.pages.length })} onVisible={onVisible}>
                      {(k) => (
                        <>
                          {(fieldsByPage.get(i) ?? []).map((f) => renderField(f, k, info))}
                          {items.filter((it) => it.page === i).map((it) => renderItem(it, k, info))}
                        </>
                      )}
                    </PageView>
                  ))}
                </div>
              )}
              {sigOpen && (
                <SignatureDialog
                  kind={sigOpen}
                  onClose={() => setSigOpen(null)}
                  onDone={(s) => {
                    setSigOpen(null)
                    if (sigOpen === 'initials') { setInitials(s); addInitials(s) } else { setSignature(s); add('signature', s) }
                  }}
                />
              )}
            </div>
          }
          side={
            <>
              {form && <p className="text-sm text-muted" data-testid="fs-summary">{fieldCount ? t('fs.hasFields', { count: fieldCount }) : t('fs.noFields')}</p>}
              <Segmented<'keep' | 'flat'>
                label={t('fs.fieldsLabel')}
                value={flatten ? 'flat' : 'keep'}
                onChange={(v) => setFlatten(v === 'flat')}
                options={[{ value: 'keep', label: t('fs.keep'), hint: t('fs.keepHint') }, { value: 'flat', label: t('fs.flat'), hint: t('fs.flatHint') }]}
              />
              <Button variant="primary" size="lg" icon="download" className="w-full" disabled={!form || nothing} onClick={save} data-testid="run">
                {t(tool.slug === 'sign-pdf' ? 'fs.runSign' : 'fs.run')}
              </Button>
              <Notice tone="info">{t('fs.limits')}</Notice>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
