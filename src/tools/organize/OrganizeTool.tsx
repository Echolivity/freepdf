import { useEffect, useState } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { PageGrid, type GridPage } from '../../components/PageGrid'
import { ToolFrame } from '../../components/ToolFrame'
import { Button, LocalBadge, Notice, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useJob } from '../../components/useJob'
import { usePdfDoc } from '../../components/thumbs'
import { deriveName } from '../../lib/files'
import { moveItem, pdfBlob } from '../../lib/output'
import type { FileKind } from '../../lib/validate'
import { runInWorker } from '../../lib/workerClient'

const ACCEPT: FileKind[] = ['pdf']
const initial = (n: number): GridPage[] => Array.from({ length: n }, (_, i) => ({ key: `p${i}`, index: i, rotation: 0 }))

export default function OrganizeTool() {
  const sel = useFiles(ACCEPT, { multiple: false })
  const file = sel.files[0] ?? null
  const { doc, error: docError, loading } = usePdfDoc(file)
  const job = useJob()
  const [pages, setPages] = useState<GridPage[]>([])
  const count = doc?.numPages ?? 0

  useEffect(() => { setPages(initial(count)) }, [count, doc])

  const changed = pages.length !== count || pages.some((p, i) => p.index !== i || p.rotation % 360 !== 0)
  const startOver = () => { job.reset(); sel.clear() }

  const save = () =>
    job.run(async ({ signal, progress }) => {
      if (!file) return []
      const bytes = await readBytes(file)
      const ops = pages.map((p) => ({ index: p.index, rotate: p.rotation % 360 }))
      const out = await runInWorker('organize', { file: { name: file.name, bytes }, ops }, { signal, onProgress: progress })
      return [{ name: deriveName(file.name, '-organized', 'pdf'), blob: pdfBlob(out), note: `${pages.length} pages` }]
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
                  <p className="text-sm text-muted">Drag pages to reorder. Use the buttons on each page to move, rotate or delete it.</p>
                  <PageGrid
                    doc={doc}
                    mode="organize"
                    pages={pages}
                    onMove={(from, to) => setPages((ps) => moveItem(ps, from, to))}
                    onRotate={(pos, d) => setPages((ps) => ps.map((p, i) => (i === pos ? { ...p, rotation: p.rotation + d } : p)))}
                    onDelete={(pos) => setPages((ps) => (ps.length > 1 ? ps.filter((_, i) => i !== pos) : ps))}
                  />
                </>
              )}
            </div>
          }
          side={
            <>
              <div>
                <p className="font-display text-3xl font-semibold">{pages.length} <span className="text-lg text-muted">pages</span></p>
                {count > 0 && pages.length !== count && <p className="text-sm text-muted">{count - pages.length} removed</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon="rotate" onClick={() => setPages((ps) => ps.map((p) => ({ ...p, rotation: p.rotation + 90 })))} disabled={!pages.length}>Rotate all</Button>
                <Button size="sm" onClick={() => setPages((ps) => [...ps].reverse())} disabled={pages.length < 2}>Reverse order</Button>
                <Button size="sm" variant="ghost" onClick={() => setPages(initial(count))} disabled={!changed}>Reset</Button>
              </div>
              <Button variant="primary" size="lg" icon="check" className="w-full" disabled={!doc || !changed || !pages.length} onClick={save} data-testid="run">
                Save PDF
              </Button>
              {doc && !changed && <p className="text-sm text-muted">Make a change to enable saving.</p>}
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
