import { useEffect, useRef, useState } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { PageGrid, type GridPage } from '../../components/PageGrid'
import { PreviewDialog } from '../../components/PreviewDialog'
import { ToolFrame } from '../../components/ToolFrame'
import { Button, LocalBadge, Notice, Rejections, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useHistory } from '../../components/useHistory'
import { useJob } from '../../components/useJob'
import { usePdfDoc } from '../../components/usePdfDoc'
import { deriveName } from '../../lib/files'
import { downloadBlob, moveItem, pdfBlob } from '../../lib/output'
import { closePdf, openPdf, PasswordRequiredError, type PDFDocumentProxy } from '../../lib/render/pdfjs'
import { UserFacingError, type FileKind, type ValidatedFile } from '../../lib/validate'
import { runInWorker } from '../../lib/workerClient'
import { useI18n } from '../../i18n/context'
import type { Message } from '../../i18n/core'

const ACCEPT: FileKind[] = ['pdf']
const EMPTY: GridPage[] = []
const letter = (src: number) => String.fromCharCode(65 + src)

interface Inserted {
  file: ValidatedFile
  doc: PDFDocumentProxy
}

export default function OrganizeTool() {
  const { t, tm } = useI18n()
  const sel = useFiles(ACCEPT, { multiple: false })
  const more = useFiles(ACCEPT, { multiple: true })
  const file = sel.files[0] ?? null
  const { doc, error: docError, loading } = usePdfDoc(file)
  const job = useJob()
  const history = useHistory<GridPage[]>(EMPTY)
  const pages = history.value
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [inserted, setInserted] = useState<Inserted[]>([])
  const [insertError, setInsertError] = useState<Message | null>(null)
  const [preview, setPreview] = useState<Uint8Array | null>(null)
  const [busy, setBusy] = useState<'preview' | 'extract' | null>(null)
  const nextKey = useRef(0)
  const insertAt = useRef<number | null>(null)
  const insertedRef = useRef<Inserted[]>([])
  const count = doc?.numPages ?? 0
  const key = (src: number, index: number) => `${src}-${index}-${nextKey.current++}`

  // New main document → fresh page list.
  const [pagesFor, setPagesFor] = useState<typeof doc>(null)
  if (pagesFor !== doc) {
    setPagesFor(doc)
    history.replace(Array.from({ length: count }, (_, i) => ({ key: `0-${i}`, index: i, rotation: 0, src: 0 })))
    setPicked(new Set())
  }

  // Files added with "Insert pages": open each one and splice its pages in.
  useEffect(() => {
    const opened = new Set(insertedRef.current.map((x) => x.file))
    const pending = more.files.filter((f) => !opened.has(f))
    if (!pending.length) return
    let dead = false
    ;(async () => {
      for (const f of pending) {
        try {
          const d = await openPdf(await readBytes(f), { name: f.name })
          if (dead) { closePdf(d); return }
          insertedRef.current = [...insertedRef.current, { file: f, doc: d }]
          const src = insertedRef.current.length
          setInserted(insertedRef.current)
          const add: GridPage[] = Array.from({ length: d.numPages }, (_, i) => ({ key: key(src, i), index: i, rotation: 0, src }))
          // Read the position now: the state updater runs later, after this loop has finished.
          const want = insertAt.current
          if (want !== null) insertAt.current = want + add.length
          history.set((ps) => {
            const at = Math.min(want ?? ps.length, ps.length)
            return [...ps.slice(0, at), ...add, ...ps.slice(at)]
          })
        } catch (e) {
          if (dead) return
          setInsertError(e instanceof PasswordRequiredError ? { key: 'err.encrypted', params: { name: f.name } } : e instanceof UserFacingError ? e.toMessage() : { key: 'err.cantOpen', params: { name: f.name } })
        }
      }
      insertAt.current = null
    })()
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [more.files])
  useEffect(() => () => insertedRef.current.forEach((x) => closePdf(x.doc)), [])

  const changed = pages.length !== count || pages.some((p, i) => p.src !== 0 || p.index !== i || p.rotation % 360 !== 0)
  const startOver = () => {
    job.reset()
    sel.clear()
    more.clear()
    insertedRef.current.forEach((x) => closePdf(x.doc))
    insertedRef.current = []
    setInserted([])
  }

  const opsOf = (list: GridPage[]) => list.map((p) => ({ src: p.src ?? 0, index: p.index, rotate: p.rotation % 360 }))
  const build = async (list: GridPage[], signal?: AbortSignal, onProgress?: (f: number, m?: Message) => void) => {
    const bytes = await readBytes(file!)
    const inserts = await Promise.all(inserted.map(async (x) => ({ name: x.file.name, bytes: await readBytes(x.file) })))
    return runInWorker('arrange', { file: { name: file!.name, bytes }, inserts, ops: opsOf(list) }, { signal, onProgress })
  }

  const save = () =>
    job.run(async ({ signal, progress }) => {
      if (!file) return []
      const out = await build(pages, signal, progress)
      return [{ name: deriveName(file.name, '-organized', 'pdf'), blob: pdfBlob(out), note: { key: 'note.pages', params: { count: pages.length } } }]
    })

  const withBusy = async (kind: 'preview' | 'extract', fn: () => Promise<void>) => {
    setBusy(kind)
    setInsertError(null)
    try { await fn() } catch (e) { setInsertError(e instanceof UserFacingError ? e.toMessage() : { key: 'err.generic' }) } finally { setBusy(null) }
  }
  const pickedPages = pages.filter((p) => picked.has(p.key))
  const n = pickedPages.length

  const update = (fn: (p: GridPage) => GridPage) => history.set((ps) => ps.map((p) => (picked.has(p.key) ? fn(p) : p)))
  const duplicateAt = (positions: number[]) =>
    history.set((ps) => {
      const out: GridPage[] = []
      ps.forEach((p, i) => { out.push(p); if (positions.includes(i)) out.push({ ...p, key: key(p.src ?? 0, p.index) }) })
      return out
    })

  const docFor = (p: GridPage) => (p.src ? inserted[p.src - 1]?.doc ?? null : doc)
  const numberFor = (p: GridPage) => (inserted.length ? `${letter(p.src ?? 0)}${p.index + 1}` : String(p.index + 1))

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
              {insertError && <Notice tone="error" onDismiss={() => setInsertError(null)}>{tm(insertError)}</Notice>}
              <Rejections items={more.rejections} onDismiss={() => more.setRejections([])} />
              {loading && <p className="text-muted" role="status">{t('common.readingPages')}</p>}
              {inserted.length > 0 && (
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted" aria-label={t('org.sources')} data-testid="sources">
                  <li dir="auto"><b className="text-ink">{letter(0)}</b> {file?.name}</li>
                  {inserted.map((x, i) => <li key={i} dir="auto"><b className="text-ink">{letter(i + 1)}</b> {x.file.name}</li>)}
                </ul>
              )}
              {doc && (
                <>
                  <p className="text-sm text-muted">{t('org.hint')}</p>
                  <PageGrid
                    doc={doc}
                    docFor={docFor}
                    numberFor={numberFor}
                    mode="organize"
                    pages={pages}
                    selectedKeys={picked}
                    onToggleKey={(k) => setPicked((s) => { const next = new Set(s); if (next.has(k)) next.delete(k); else next.add(k); return next })}
                    onMove={(from, to) => history.set((ps) => moveItem(ps, from, to))}
                    onRotate={(pos, d) => history.set((ps) => ps.map((p, i) => (i === pos ? { ...p, rotation: p.rotation + d } : p)))}
                    onDelete={(pos) => history.set((ps) => (ps.length > 1 ? ps.filter((_, i) => i !== pos) : ps))}
                    onDuplicate={(pos) => duplicateAt([pos])}
                  />
                </>
              )}
              {preview && file && (
                <PreviewDialog
                  bytes={preview}
                  title={t('preview.titleOrganize')}
                  onClose={() => setPreview(null)}
                  onDownload={() => downloadBlob(pdfBlob(preview), deriveName(file.name, '-organized', 'pdf'))}
                />
              )}
            </div>
          }
          side={
            <>
              <div>
                <p className="font-display text-3xl font-semibold">{pages.length} <span className="text-lg text-muted">{t('org.unit', { count: pages.length })}</span></p>
                {n > 0 && <p className="text-sm text-muted" data-testid="picked-count">{t('org.picked', { count: n })}</p>}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" icon="undo" onClick={history.undo} disabled={!history.canUndo} data-testid="undo">{t('history.undo')}</Button>
                <Button size="sm" variant="ghost" icon="redo" onClick={history.redo} disabled={!history.canRedo} data-testid="redo">{t('history.redo')}</Button>
              </div>
              {n > 0 ? (
                <div className="flex flex-wrap gap-2" role="group" aria-label={t('org.selectedActions')}>
                  <Button size="sm" icon="rotate" onClick={() => update((p) => ({ ...p, rotation: p.rotation + 90 }))}>{t('org.rotateSel')}</Button>
                  <Button size="sm" icon="copy" onClick={() => duplicateAt(pages.flatMap((p, i) => (picked.has(p.key) ? [i] : [])))}>{t('org.duplicateSel')}</Button>
                  <Button size="sm" icon="trash" onClick={() => { if (n < pages.length) { history.set((ps) => ps.filter((p) => !picked.has(p.key))); setPicked(new Set()) } }} disabled={n >= pages.length}>{t('org.deleteSel')}</Button>
                  <Button size="sm" icon="extract" disabled={busy !== null} data-testid="extract-selected"
                    onClick={() => withBusy('extract', async () => downloadBlob(pdfBlob(await build(pickedPages)), deriveName(file!.name, '-selected', 'pdf')))}>
                    {t('org.extractSel')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>{t('select.clear')}</Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" icon="rotate" onClick={() => history.set((ps) => ps.map((p) => ({ ...p, rotation: p.rotation + 90 })))} disabled={!pages.length}>{t('org.rotateAll')}</Button>
                  <Button size="sm" onClick={() => history.set((ps) => [...ps].reverse())} disabled={pages.length < 2}>{t('org.reverse')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(pages.map((p) => p.key)))} disabled={!pages.length}>{t('select.all')}</Button>
                </div>
              )}
              <div>
                <p className="mb-1.5 text-sm font-semibold">{t('org.insert')}</p>
                <Dropzone
                  accept={ACCEPT}
                  multiple
                  compact
                  onFiles={(files) => {
                    // Insert after the last selected page (or at the end), whether the files were picked or dropped.
                    const last = pages.reduce((m, p, i) => (picked.has(p.key) ? i + 1 : m), -1)
                    insertAt.current = last >= 0 ? last : null
                    more.add(files)
                  }}
                />
                <p className="mt-1 text-xs text-muted">{t('org.insertHint')}</p>
              </div>
              <Button icon="eye" className="w-full" disabled={!doc || !changed || !pages.length || busy !== null} data-testid="preview"
                onClick={() => withBusy('preview', async () => setPreview(await build(pages)))}>
                {busy === 'preview' ? t('preview.building') : t('preview.open')}
              </Button>
              <Button variant="primary" size="lg" icon="check" className="w-full" disabled={!doc || !changed || !pages.length} onClick={save} data-testid="run">
                {t('org.save')}
              </Button>
              {doc && !changed && <p className="text-sm text-muted">{t('org.makeChange')}</p>}
              {inserted.length > 0 && <p className="text-xs text-muted">{t('org.insertNote')}</p>}
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
