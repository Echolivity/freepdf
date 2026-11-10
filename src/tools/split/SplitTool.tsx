import { useMemo, useState } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { PageGrid } from '../../components/PageGrid'
import { ToolFrame } from '../../components/ToolFrame'
import { Button, LocalBadge, Notice, Segmented, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useJob } from '../../components/useJob'
import { usePdfDoc } from '../../components/thumbs'
import { deriveName } from '../../lib/files'
import { pdfBlob } from '../../lib/output'
import { chunkGroups, formatRanges, parseRanges } from '../../lib/ranges'
import type { FileKind } from '../../lib/validate'
import { runInWorker } from '../../lib/workerClient'

const ACCEPT: FileKind[] = ['pdf']
type Mode = 'ranges' | 'every' | 'chunk'

export default function SplitTool() {
  const sel = useFiles(ACCEPT, { multiple: false })
  const file = sel.files[0] ?? null
  const { doc, error: docError, loading } = usePdfDoc(file)
  const job = useJob()
  const [mode, setMode] = useState<Mode>('ranges')
  const [rangeText, setRangeText] = useState('')
  const [chunk, setChunk] = useState(2)
  const [mergeRanges, setMergeRanges] = useState(false)
  const startOver = () => { job.reset(); sel.clear(); setRangeText('') }

  const count = doc?.numPages ?? 0
  const plan = useMemo((): { groups: number[][] | null; error: string | null } => {
    if (!count) return { groups: null, error: null }
    try {
      if (mode === 'every') return { groups: chunkGroups(count, 1), error: null }
      if (mode === 'chunk') return { groups: chunkGroups(count, chunk), error: null }
      const text = rangeText.trim() || (count > 1 ? `1-${Math.ceil(count / 2)}, ${Math.ceil(count / 2) + 1}-${count}` : '1')
      return { groups: parseRanges(text, count), error: null }
    } catch (e) {
      return { groups: null, error: (e as Error).message }
    }
  }, [count, mode, rangeText, chunk])

  const partOf = useMemo(() => {
    const m = new Map<number, number[]>()
    plan.groups?.forEach((g, gi) => g.forEach((p) => m.set(p, [...(m.get(p) ?? []), gi + 1])))
    return m
  }, [plan.groups])

  const willMerge = mode === 'ranges' && mergeRanges
  const outputs = plan.groups ? (willMerge ? 1 : plan.groups.length) : 0

  const split = () =>
    job.run(async ({ signal, progress }) => {
      if (!file || !plan.groups) return []
      const bytes = await readBytes(file)
      const input = { name: file.name, bytes }
      if (willMerge) {
        const indices = plan.groups.flat()
        const out = await runInWorker('extract', { file: input, indices }, { signal, onProgress: progress })
        return [{ name: deriveName(file.name, `-pages-${formatRanges(indices).replace(/, /g, '_')}`, 'pdf'), blob: pdfBlob(out) }]
      }
      const parts = await runInWorker('split', { file: input, groups: plan.groups }, { signal, onProgress: progress })
      return parts.map((p, i) => {
        const g = plan.groups![i]
        const label = g.length === 1 ? `page-${g[0] + 1}` : `pages-${g[0] + 1}-${g[g.length - 1] + 1}`
        return { name: deriveName(file.name, `-${label}`, 'pdf'), blob: pdfBlob(p) }
      })
    })

  return (
    <ToolFrame
      job={job}
      hasInput={!!file}
      rejections={sel.rejections}
      onDismissRejections={() => sel.setRejections([])}
      onStartOver={startOver}
      zipName={file ? deriveName(file.name, '-split', 'zip') : undefined}
      dropzone={<Dropzone accept={ACCEPT} multiple={false} onFiles={sel.add} />}
      workspace={
        <Workspace
          main={
            <div className="space-y-4">
              {file && <FileList files={[file]} onRemove={startOver} extra={() => (count ? ` · ${count} pages` : '')} />}
              {docError && <Notice tone="error">{docError}</Notice>}
              {loading && <p className="text-muted" role="status">Reading pages…</p>}
              {doc && (
                <PageGrid
                  doc={doc}
                  mode="view"
                  pages={Array.from({ length: count }, (_, i) => ({ key: String(i), index: i, rotation: 0 }))}
                  labelFor={(p) => {
                    const parts = partOf.get(p.index)
                    if (!parts) return willMerge ? undefined : 'not included'
                    return willMerge ? 'included' : `file ${parts.join(', ')}`
                  }}
                />
              )}
            </div>
          }
          side={
            <>
              <Segmented<Mode>
                label="Split method"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'ranges', label: 'Ranges' },
                  { value: 'every', label: 'Every page' },
                  { value: 'chunk', label: 'Every N' },
                ]}
              />
              {mode === 'ranges' && (
                <div className="space-y-3">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-semibold">Page ranges</span>
                    <input
                      value={rangeText}
                      onChange={(e) => setRangeText(e.target.value)}
                      placeholder={count > 1 ? `1-${Math.ceil(count / 2)}, ${Math.ceil(count / 2) + 1}-${count}` : '1'}
                      className="h-11 w-full rounded-xl border border-line-strong bg-paper px-3 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
                      aria-describedby="range-help"
                      data-testid="ranges"
                    />
                    <span id="range-help" className="mt-1.5 block text-sm text-muted">Each comma-separated range becomes its own file. Example: 1-3, 5, 8-</span>
                  </label>
                  <label className="flex items-start gap-2.5 text-[15px]">
                    <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--accent)]" checked={mergeRanges} onChange={(e) => setMergeRanges(e.target.checked)} />
                    Put all ranges into one PDF
                  </label>
                </div>
              )}
              {mode === 'chunk' && (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">Pages per file</span>
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, count)}
                    value={chunk}
                    onChange={(e) => setChunk(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="h-11 w-full rounded-xl border border-line-strong bg-paper px-3 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
                  />
                </label>
              )}
              {!plan.error && !willMerge && outputs > 40 && (
                <p className="text-sm text-muted">With more than 40 parts, page content is kept but bookmarks and fillable form fields are not.</p>
              )}
              {plan.error && <p className="text-sm font-semibold text-danger" role="alert">{plan.error}</p>}
              {!plan.error && outputs > 0 && (
                <p className="text-sm text-muted">Creates <strong className="text-ink">{outputs}</strong> PDF{outputs === 1 ? '' : 's'}{outputs > 1 ? ', downloadable as a ZIP' : ''}.</p>
              )}
              <Button variant="primary" size="lg" icon="split" className="w-full" disabled={!plan.groups || !doc} onClick={split} data-testid="run">
                Split PDF
              </Button>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
