import { useState } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { ToolFrame } from '../../components/ToolFrame'
import { Button, LocalBadge, Segmented, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useJob } from '../../components/useJob'
import { deriveName, formatBytes } from '../../lib/files'
import { pdfBlob, type OutputFile } from '../../lib/output'
import type { CompressionLevel } from '../../lib/pdf/compress'
import type { FileKind } from '../../lib/validate'
import { runInWorker } from '../../lib/workerClient'

const ACCEPT: FileKind[] = ['pdf']

export default function CompressTool() {
  const sel = useFiles(ACCEPT, { multiple: true })
  const job = useJob()
  const [level, setLevel] = useState<CompressionLevel>('balanced')
  const startOver = () => { job.reset(); sel.clear() }

  const compress = () =>
    job.run(async ({ signal, progress }) => {
      const out: OutputFile[] = []
      let before = 0
      let after = 0
      let unchanged = 0
      for (let i = 0; i < sel.files.length; i++) {
        const f = sel.files[i]
        const base = i / sel.files.length
        const res = await runInWorker(
          'compress',
          { file: { name: f.name, bytes: await readBytes(f) }, level },
          { signal, onProgress: (v, l) => progress(base + v / sel.files.length, sel.files.length > 1 ? `${f.name}: ${l ?? ''}` : l) },
        )
        before += res.originalSize
        after += res.bytes.length
        if (res.unchanged) unchanged++
        const saved = 1 - res.bytes.length / res.originalSize
        out.push({
          name: deriveName(f.name, res.unchanged ? '' : '-compressed', 'pdf'),
          blob: pdfBlob(res.bytes),
          note: res.unchanged
            ? 'Already well optimised — returned unchanged'
            : `${formatBytes(res.originalSize)} → ${formatBytes(res.bytes.length)} (−${Math.round(saved * 100)}%)`,
        })
      }
      const pct = before ? Math.round((1 - after / before) * 100) : 0
      const summary =
        unchanged === sel.files.length
          ? 'These files were already well optimised; no smaller version could be made, so the originals are returned. Text-only PDFs usually can’t shrink much.'
          : `${formatBytes(before)} → ${formatBytes(after)} · ${pct}% smaller`
      return { files: out, summary }
    })

  return (
    <ToolFrame
      job={job}
      hasInput={sel.files.length > 0}
      rejections={sel.rejections}
      onDismissRejections={() => sel.setRejections([])}
      onStartOver={startOver}
      zipName="compressed-pdfs.zip"
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
              <Segmented<CompressionLevel>
                label="Compression"
                value={level}
                onChange={setLevel}
                options={[
                  { value: 'light', label: 'Light', hint: 'Best quality' },
                  { value: 'balanced', label: 'Balanced', hint: 'Recommended' },
                  { value: 'strong', label: 'Strong', hint: 'Smallest' },
                ]}
              />
              <p className="text-sm text-muted">
                Photos and scans inside the PDF are re-encoded{level !== 'light' ? ' and downscaled if very large' : ''}. Text, vector
                graphics, links and forms are untouched. If a file can’t be made smaller, you get the original back.
              </p>
              <Button variant="primary" size="lg" icon="compress" className="w-full" onClick={compress} data-testid="run">
                Compress {sel.files.length > 1 ? `${sel.files.length} PDFs` : 'PDF'}
              </Button>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
