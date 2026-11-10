import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { ToolFrame } from '../../components/ToolFrame'
import { Button, LocalBadge, Segmented, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useJob } from '../../components/useJob'
import { Icon } from '../../components/Icon'
import { deriveName } from '../../lib/files'
import { pdfBlob, type OutputFile } from '../../lib/output'
import type { FileKind } from '../../lib/validate'
import { runInWorker } from '../../lib/workerClient'

const ACCEPT: FileKind[] = ['pdf']

export default function RotateTool() {
  const sel = useFiles(ACCEPT, { multiple: true })
  const job = useJob()
  const [angle, setAngle] = useState<90 | 180 | 270>(90)
  const startOver = () => { job.reset(); sel.clear() }

  const rotate = () =>
    job.run(async ({ signal, progress }) => {
      const out: OutputFile[] = []
      for (let i = 0; i < sel.files.length; i++) {
        const f = sel.files[i]
        progress(i / sel.files.length, `Rotating ${f.name}`)
        const bytes = await runInWorker('rotate', { file: { name: f.name, bytes: await readBytes(f) }, angle, indices: null }, { signal })
        out.push({ name: deriveName(f.name, '-rotated', 'pdf'), blob: pdfBlob(bytes) })
      }
      return out
    })

  return (
    <ToolFrame
      job={job}
      hasInput={sel.files.length > 0}
      rejections={sel.rejections}
      onDismissRejections={() => sel.setRejections([])}
      onStartOver={startOver}
      zipName="rotated-pdfs.zip"
      dropzone={<Dropzone accept={ACCEPT} multiple onFiles={sel.add} />}
      workspace={
        <Workspace
          main={
            <div className="space-y-3">
              <FileList files={sel.files} onRemove={sel.remove} />
              <Dropzone accept={ACCEPT} multiple compact onFiles={sel.add} />
            </div>
          }
          side={
            <>
              <Segmented<90 | 180 | 270>
                label="Rotate every page"
                value={angle}
                onChange={setAngle}
                options={[
                  { value: 90, label: '90° right' },
                  { value: 180, label: '180°' },
                  { value: 270, label: '90° left' },
                ]}
              />
              <div className="flex items-center justify-center gap-6 py-2 text-muted" aria-hidden="true">
                <span className="grid h-20 w-16 place-items-center rounded-md border-2 border-line-strong bg-paper font-display text-2xl font-bold">A</span>
                <Icon name="arrowLeft" style={{ transform: 'scaleX(-1)' }} />
                <span className="grid h-20 w-16 place-items-center rounded-md border-2 border-accent bg-paper font-display text-2xl font-bold text-accent transition-transform" style={{ transform: `rotate(${angle}deg)` }}>A</span>
              </div>
              <Button variant="primary" size="lg" icon="rotate" className="w-full" onClick={rotate} data-testid="run">
                Rotate {sel.files.length > 1 ? `${sel.files.length} PDFs` : 'PDF'}
              </Button>
              <p className="text-sm text-muted">
                Need to rotate only some pages? Use <Link to="/organize-pdf" className="font-semibold text-accent underline underline-offset-4">Organize PDF</Link>.
              </p>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
