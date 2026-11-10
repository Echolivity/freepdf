import { useState } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { ToolFrame } from '../../components/ToolFrame'
import { Button, LocalBadge, Segmented, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useJob } from '../../components/useJob'
import { deriveName } from '../../lib/files'
import { pdfBlob, type OutputFile } from '../../lib/output'
import type { Orientation, PageSize } from '../../lib/pdf/images'
import type { FileKind } from '../../lib/validate'
import { runInWorker } from '../../lib/workerClient'

const ACCEPT: FileKind[] = ['jpeg', 'png', 'webp']
type Margin = 0 | 18 | 36
type Output = 'single' | 'each'

export default function ImageToPdfTool() {
  const sel = useFiles(ACCEPT, { multiple: true })
  const job = useJob()
  const [pageSize, setPageSize] = useState<PageSize>('a4')
  const [orientation, setOrientation] = useState<Orientation>('auto')
  const [margin, setMargin] = useState<Margin>(18)
  const [output, setOutput] = useState<Output>('single')
  const startOver = () => { job.reset(); sel.clear() }

  const convert = () =>
    job.run(async ({ signal, progress }) => {
      progress(0, 'Reading images')
      const images = await Promise.all(
        sel.files.map(async (f) => ({ name: f.name, kind: f.kind as 'jpeg' | 'png' | 'webp', bytes: await readBytes(f) })),
      )
      const options = { pageSize, orientation, margin }
      if (output === 'single' || images.length === 1) {
        const pdf = await runInWorker('imagesToPdf', { images, options }, { signal, onProgress: progress })
        const name = images.length === 1 ? deriveName(images[0].name, '', 'pdf') : deriveName(images[0].name, '-and-more', 'pdf')
        return [{ name, blob: pdfBlob(pdf), note: `${images.length} page${images.length === 1 ? '' : 's'}` }]
      }
      const out: OutputFile[] = []
      for (let i = 0; i < images.length; i++) {
        progress(i / images.length, `Converting ${images[i].name}`)
        const pdf = await runInWorker('imagesToPdf', { images: [images[i]], options }, { signal })
        out.push({ name: deriveName(images[i].name, '', 'pdf'), blob: pdfBlob(pdf) })
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
      zipName="images-to-pdf.zip"
      dropzone={<Dropzone accept={ACCEPT} multiple onFiles={sel.add} />}
      workspace={
        <Workspace
          main={
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted">Each image becomes a page, in this order.</p>
                <Button variant="ghost" size="sm" onClick={sel.sortByName}>Sort A–Z</Button>
              </div>
              <FileList files={sel.files} reorderable onMove={sel.move} onRemove={sel.remove} />
              <Dropzone accept={ACCEPT} multiple compact onFiles={sel.add} />
            </div>
          }
          side={
            <>
              <Segmented<PageSize>
                label="Page size"
                value={pageSize}
                onChange={setPageSize}
                options={[
                  { value: 'a4', label: 'A4' },
                  { value: 'letter', label: 'Letter' },
                  { value: 'fit', label: 'Fit image' },
                ]}
              />
              {pageSize !== 'fit' && (
                <Segmented<Orientation>
                  label="Orientation"
                  value={orientation}
                  onChange={setOrientation}
                  options={[
                    { value: 'auto', label: 'Auto' },
                    { value: 'portrait', label: 'Portrait' },
                    { value: 'landscape', label: 'Landscape' },
                  ]}
                />
              )}
              <Segmented<Margin>
                label="Margin"
                value={margin}
                onChange={setMargin}
                options={[
                  { value: 0, label: 'None' },
                  { value: 18, label: 'Small' },
                  { value: 36, label: 'Large' },
                ]}
              />
              {sel.files.length > 1 && (
                <Segmented<Output>
                  label="Output"
                  value={output}
                  onChange={setOutput}
                  options={[
                    { value: 'single', label: 'One PDF' },
                    { value: 'each', label: 'PDF per image' },
                  ]}
                />
              )}
              <Button variant="primary" size="lg" icon="imageIn" className="w-full" onClick={convert} data-testid="run">
                Convert to PDF
              </Button>
              <p className="text-sm text-muted">Images are embedded at full quality — JPGs are not re-compressed.</p>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
