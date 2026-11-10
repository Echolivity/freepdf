import { useEffect, useRef, useState } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { PageGrid } from '../../components/PageGrid'
import { ToolFrame } from '../../components/ToolFrame'
import { Button, LocalBadge, Notice, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useJob } from '../../components/useJob'
import { usePdfDoc } from '../../components/thumbs'
import { deriveName } from '../../lib/files'
import { pdfBlob } from '../../lib/output'
import { formatRanges, parsePageSet } from '../../lib/ranges'
import type { FileKind } from '../../lib/validate'
import { runInWorker } from '../../lib/workerClient'

const ACCEPT: FileKind[] = ['pdf']

/** Shared UI for Extract pages and Remove pages: pick pages by clicking thumbnails or typing ranges. */
export function PageSelectTool({ variant }: { variant: 'extract' | 'remove' }) {
  const sel = useFiles(ACCEPT, { multiple: false })
  const file = sel.files[0] ?? null
  const { doc, error: docError, loading } = usePdfDoc(file)
  const job = useJob()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [text, setText] = useState('')
  const [textError, setTextError] = useState<string | null>(null)
  const anchor = useRef<number | null>(null)
  const count = doc?.numPages ?? 0
  const isRemove = variant === 'remove'

  useEffect(() => { setSelected(new Set()); setText(''); setTextError(null) }, [file])

  const commit = (next: Set<number>) => {
    setSelected(next)
    setText(formatRanges([...next]))
    setTextError(null)
  }

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
    if (!v.trim()) { setSelected(new Set()); setTextError(null); return }
    try {
      setSelected(new Set(parsePageSet(v, count)))
      setTextError(null)
    } catch (e) {
      setTextError((e as Error).message)
    }
  }

  const startOver = () => { job.reset(); sel.clear() }
  const n = selected.size
  const invalid = !n || !!textError || (isRemove && n >= count)

  const run = () =>
    job.run(async ({ signal, progress }) => {
      if (!file) return []
      const bytes = await readBytes(file)
      const indices = [...selected].sort((a, b) => a - b)
      const out = await runInWorker(variant, { file: { name: file.name, bytes }, indices }, { signal, onProgress: progress })
      const suffix = isRemove ? '-edited' : `-pages-${formatRanges(indices).replace(/, /g, '_')}`
      return [{ name: deriveName(file.name, suffix.slice(0, 60), 'pdf'), blob: pdfBlob(out), note: isRemove ? `${count - n} of ${count} pages kept` : `${n} page${n === 1 ? '' : 's'}` }]
    })

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
              {file && <FileList files={[file]} onRemove={startOver} extra={() => (count ? ` · ${count} pages` : '')} />}
              {docError && <Notice tone="error">{docError}</Notice>}
              {loading && <p className="text-muted" role="status">Reading pages…</p>}
              {doc && (
                <>
                  <p className="text-sm text-muted">Click pages to {isRemove ? 'mark them for removal' : 'select them'}. Shift-click selects a run of pages.</p>
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
            </div>
          }
          side={
            <>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">{isRemove ? 'Pages to remove' : 'Pages to extract'}</span>
                <input
                  value={text}
                  onChange={(e) => onText(e.target.value)}
                  placeholder="e.g. 1-3, 7"
                  disabled={!count}
                  className="h-11 w-full rounded-xl border border-line-strong bg-paper px-3 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
                  data-testid="ranges"
                />
              </label>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => commit(new Set(Array.from({ length: count }, (_, i) => i)))} disabled={!count}>Select all</Button>
                <Button size="sm" variant="ghost" onClick={() => commit(new Set())} disabled={!n}>Clear</Button>
              </div>
              {textError && <p className="text-sm font-semibold text-danger" role="alert">{textError}</p>}
              {!textError && isRemove && n >= count && count > 0 && <p className="text-sm font-semibold text-danger" role="alert">At least one page has to stay.</p>}
              {!textError && n > 0 && !(isRemove && n >= count) && (
                <p className="text-sm text-muted">
                  {isRemove ? <>Removes <strong className="text-ink">{n}</strong> page{n === 1 ? '' : 's'}; {count - n} will remain.</> : <>New PDF with <strong className="text-ink">{n}</strong> page{n === 1 ? '' : 's'}.</>}
                </p>
              )}
              <Button variant="primary" size="lg" icon={isRemove ? 'remove' : 'extract'} className="w-full" disabled={invalid || !doc} onClick={run} data-testid="run">
                {isRemove ? 'Remove pages' : 'Extract pages'}
              </Button>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
