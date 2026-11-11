import { useRef, useState } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { PageGrid } from '../../components/PageGrid'
import { PreviewDialog } from '../../components/PreviewDialog'
import { ToolFrame } from '../../components/ToolFrame'
import { Button, LocalBadge, Notice, Segmented, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useHistory } from '../../components/useHistory'
import { useJob } from '../../components/useJob'
import { usePdfDoc } from '../../components/usePdfDoc'
import { deriveName } from '../../lib/files'
import { downloadBlob, pdfBlob, type OutputFile } from '../../lib/output'
import { formatRanges, parsePageSet } from '../../lib/ranges'
import type { FileKind } from '../../lib/validate'
import { runInWorker } from '../../lib/workerClient'
import { UserFacingError } from '../../lib/validate'
import { useI18n } from '../../i18n/context'
import type { Message } from '../../i18n/core'

const ACCEPT: FileKind[] = ['pdf']
type Output = 'single' | 'separate'
const EMPTY = new Set<number>()

/**
 * Shared UI for Extract PDF pages and Delete PDF pages: pick pages by clicking thumbnails, typing
 * ranges, or quick picks (all, odd, even, invert); undo/redo the selection.
 */
export function PageSelectTool({ variant }: { variant: 'extract' | 'remove' }) {
  const { t, tm } = useI18n()
  const sel = useFiles(ACCEPT, { multiple: false })
  const file = sel.files[0] ?? null
  const { doc, error: docError, loading } = usePdfDoc(file)
  const job = useJob()
  const history = useHistory<Set<number>>(EMPTY)
  const selected = history.value
  const [text, setText] = useState('')
  const [textError, setTextError] = useState<Message | null>(null)
  const [output, setOutput] = useState<Output>('single')
  const [preview, setPreview] = useState<{ bytes: Uint8Array; name: string } | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const anchor = useRef<number | null>(null)
  const count = doc?.numPages ?? 0
  const isRemove = variant === 'remove'

  const [selectionFor, setSelectionFor] = useState(file)
  if (selectionFor !== file) {
    setSelectionFor(file)
    history.replace(EMPTY)
    setText('')
    setTextError(null)
  }
  // Keep the range field in step with undo/redo.
  // (Not when the change came from typing in it, so the user's text isn't rewritten as they type.)
  const [typed, setTyped] = useState<Set<number> | null>(null)
  const [textFor, setTextFor] = useState(selected)
  if (textFor !== selected) {
    setTextFor(selected)
    if (selected !== typed) { setText(formatRanges([...selected])); setTextError(null) }
  }

  const commit = (next: Set<number>) => {
    history.set(next)
    setText(formatRanges([...next]))
    setTextError(null)
  }
  const all = () => Array.from({ length: count }, (_, i) => i)
  const pick = (f: (i: number) => boolean) => commit(new Set(all().filter(f)))

  const toggle = (i: number, shift: boolean) => {
    const next = new Set(selected)
    if (shift && anchor.current !== null) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)]
      for (let k = a; k <= b; k++) next.add(k)
    } else if (next.has(i)) next.delete(i)
    else next.add(i)
    anchor.current = i
    commit(next)
  }

  const onText = (v: string) => {
    setText(v)
    if (!v.trim()) { setTyped(EMPTY); history.set(EMPTY); setTextError(null); return }
    try {
      const next = new Set(parsePageSet(v, count))
      setTyped(next)
      history.set(next)
      setTextError(null)
    } catch (e) {
      setTextError(e instanceof UserFacingError ? e.toMessage() : { key: 'rng.empty' })
    }
  }

  const startOver = () => { job.reset(); sel.clear() }
  const n = selected.size
  const invalid = !n || !!textError || (isRemove && n >= count)
  const indices = () => [...selected].sort((a, b) => a - b)

  const removeBytes = async (signal?: AbortSignal) => {
    const bytes = await readBytes(file!)
    return runInWorker('remove', { file: { name: file!.name, bytes }, indices: indices() }, { signal })
  }
  const removedName = () => deriveName(file!.name, '-edited', 'pdf')

  const showPreview = async () => {
    if (!file) return
    setPreviewBusy(true)
    try {
      setPreview({ bytes: await removeBytes(), name: removedName() })
    } catch (e) {
      setTextError(e instanceof UserFacingError ? e.toMessage() : { key: 'err.generic' })
    } finally {
      setPreviewBusy(false)
    }
  }

  const run = () =>
    job.run(async ({ signal, progress }): Promise<OutputFile[]> => {
      if (!file) return []
      const idx = indices()
      if (isRemove) {
        const out = await removeBytes(signal)
        return [{ name: removedName(), blob: pdfBlob(out), note: { key: 'note.pagesKept', params: { kept: count - n, total: count } } }]
      }
      const bytes = await readBytes(file)
      if (output === 'separate') {
        const parts = await runInWorker('split', { file: { name: file.name, bytes }, groups: idx.map((i) => [i]) }, { signal, onProgress: progress })
        return parts.map((b, k) => ({ name: deriveName(file.name, `-page-${idx[k] + 1}`, 'pdf'), blob: pdfBlob(b) }))
      }
      const out = await runInWorker('extract', { file: { name: file.name, bytes }, indices: idx }, { signal, onProgress: progress })
      const suffix = `-pages-${formatRanges(idx).replace(/, /g, '_')}`
      return [{ name: deriveName(file.name, suffix.slice(0, 60), 'pdf'), blob: pdfBlob(out), note: { key: 'note.pages', params: { count: n } } }]
    })

  return (
    <ToolFrame
      job={job}
      hasInput={!!file}
      rejections={sel.rejections}
      onDismissRejections={() => sel.setRejections([])}
      onStartOver={startOver}
      zipName={file ? deriveName(file.name, '-pages', 'zip') : 'pages.zip'}
      dropzone={<Dropzone accept={ACCEPT} multiple={false} onFiles={sel.add} />}
      workspace={
        <Workspace
          main={
            <div className="space-y-4">
              {file && <FileList files={[file]} onRemove={startOver} extra={() => (count ? t('files.pages', { count }) : '')} />}
              {docError && <Notice tone="error">{tm(docError)}</Notice>}
              {loading && <p className="text-muted" role="status">{t('common.readingPages')}</p>}
              {doc && (
                <>
                  <p className="text-sm text-muted">{t(isRemove ? 'select.hintRemove' : 'select.hintExtract')}</p>
                  <PageGrid
                    doc={doc}
                    mode="select"
                    selectTone={isRemove ? 'danger' : 'accent'}
                    selected={selected}
                    onToggle={toggle}
                    pages={Array.from({ length: count }, (_, i) => ({ key: String(i), index: i, rotation: 0 }))}
                  />
                </>
              )}
              {preview && (
                <PreviewDialog
                  bytes={preview.bytes}
                  title={t('preview.titleRemove')}
                  onClose={() => setPreview(null)}
                  onDownload={() => downloadBlob(pdfBlob(preview.bytes), preview.name)}
                />
              )}
            </div>
          }
          side={
            <>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">{t(isRemove ? 'select.labelRemove' : 'select.labelExtract')}</span>
                <input
                  value={text}
                  onChange={(e) => onText(e.target.value)}
                  placeholder={t('select.placeholder')}
                  disabled={!count}
                  dir="ltr"
                  inputMode="numeric"
                  className="h-11 w-full rounded-xl border border-line-strong bg-paper px-3 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
                  data-testid="ranges"
                />
              </label>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t('select.quick')}>
                <Button size="sm" onClick={() => pick(() => true)} disabled={!count}>{t('select.all')}</Button>
                <Button size="sm" onClick={() => pick((i) => i % 2 === 0)} disabled={!count} data-testid="pick-odd">{t('select.odd')}</Button>
                <Button size="sm" onClick={() => pick((i) => i % 2 === 1)} disabled={count < 2} data-testid="pick-even">{t('select.even')}</Button>
                <Button size="sm" onClick={() => pick((i) => !selected.has(i))} disabled={!count}>{t('select.invert')}</Button>
                <Button size="sm" variant="ghost" onClick={() => commit(new Set())} disabled={!n}>{t('select.clear')}</Button>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" icon="undo" onClick={history.undo} disabled={!history.canUndo} data-testid="undo">{t('history.undo')}</Button>
                <Button size="sm" variant="ghost" icon="redo" onClick={history.redo} disabled={!history.canRedo} data-testid="redo">{t('history.redo')}</Button>
              </div>
              {textError && <p className="text-sm font-semibold text-danger" role="alert">{tm(textError)}</p>}
              {!textError && isRemove && n >= count && count > 0 && <p className="text-sm font-semibold text-danger" role="alert">{t('select.keepOne')}</p>}
              {!isRemove && (
                <Button size="sm" variant="ghost" icon="split" onClick={() => { pick(() => true); setOutput('separate') }} disabled={!count} data-testid="every-page">
                  {t('select.everyPage')}
                </Button>
              )}
              {!isRemove && (
                <Segmented<Output>
                  label={t('select.output')}
                  value={output}
                  onChange={setOutput}
                  options={[
                    { value: 'single', label: t('select.out.single'), hint: t('select.out.singleHint') },
                    { value: 'separate', label: t('select.out.separate'), hint: t('select.out.separateHint') },
                  ]}
                />
              )}
              {!textError && n > 0 && !(isRemove && n >= count) && (
                <p className="text-sm text-muted" data-testid="selection-summary">
                  {isRemove
                    ? t('select.removes', { count: n, remain: t('note.pages', { count: count - n }) })
                    : output === 'separate' ? t('select.newPdfs', { count: n }) : t('select.newPdf', { count: n })}
                </p>
              )}
              {isRemove && (
                <Button icon="eye" className="w-full" disabled={invalid || !doc || previewBusy} onClick={showPreview} data-testid="preview">
                  {previewBusy ? t('preview.building') : t('preview.open')}
                </Button>
              )}
              <Button variant="primary" size="lg" icon={isRemove ? 'remove' : 'extract'} className="w-full" disabled={invalid || !doc} onClick={run} data-testid="run">
                {t(isRemove ? 'select.runRemove' : output === 'separate' ? 'select.runExtractSeparate' : 'select.runExtract')}
              </Button>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
