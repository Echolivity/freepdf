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
import { useI18n } from '../../i18n/react'

const ACCEPT: FileKind[] = ['jpeg', 'png', 'webp']
type Margin = 0 | 18 | 36
type Output = 'single' | 'each'

export default function ImageToPdfTool() {
  const { t } = useI18n()
  const sel = useFiles(ACCEPT, { multiple: true })
  const job = useJob()
  const [pageSize, setPageSize] = useState<PageSize>('a4')
  const [orientation, setOrientation] = useState<Orientation>('auto')
  const [margin, setMargin] = useState<Margin>(18)
  const [output, setOutput] = useState<Output>('single')
  const startOver = () => { job.reset(); sel.clear() }

  const convert = () =>
    job.run(async ({ signal, progress }) => {
      progress(0, { key: 'prog.readingImages' })
      const images = await Promise.all(
        sel.files.map(async (f) => ({ name: f.name, kind: f.kind as 'jpeg' | 'png' | 'webp', bytes: await readBytes(f) })),
      )
      const options = { pageSize, orientation, margin }
      if (output === 'single' || images.length === 1) {
        const pdf = await runInWorker('imagesToPdf', { images, options }, { signal, onProgress: progress })
        const name = images.length === 1 ? deriveName(images[0].name, '', 'pdf') : deriveName(images[0].name, '-and-more', 'pdf')
        return [{ name, blob: pdfBlob(pdf), note: { key: 'note.pages', params: { count: images.length } } }]
      }
      const out: OutputFile[] = []
      for (let i = 0; i < images.length; i++) {
        progress(i / images.length, { key: 'i2p.converting', params: { name: images[i].name } })
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
                <p className="text-sm text-muted">{t('i2p.hint')}</p>
                <Button variant="ghost" size="sm" onClick={sel.sortByName}>{t('common.sortAZ')}</Button>
              </div>
              <FileList files={sel.files} reorderable onMove={sel.move} onRemove={sel.remove} />
              <Dropzone accept={ACCEPT} multiple compact onFiles={sel.add} />
            </div>
          }
          side={
            <>
              <Segmented<PageSize>
                label={t('i2p.pageSize')}
                value={pageSize}
                onChange={setPageSize}
                options={[
                  { value: 'a4', label: t('i2p.a4') },
                  { value: 'letter', label: t('i2p.letter') },
                  { value: 'fit', label: t('i2p.fit') },
                ]}
              />
              {pageSize !== 'fit' && (
                <Segmented<Orientation>
                  label={t('i2p.orientation')}
                  value={orientation}
                  onChange={setOrientation}
                  options={[
                    { value: 'auto', label: t('i2p.auto') },
                    { value: 'portrait', label: t('i2p.portrait') },
                    { value: 'landscape', label: t('i2p.landscape') },
                  ]}
                />
              )}
              <Segmented<Margin>
                label={t('i2p.margin')}
                value={margin}
                onChange={setMargin}
                options={[
                  { value: 0, label: t('i2p.none') },
                  { value: 18, label: t('i2p.small') },
                  { value: 36, label: t('i2p.large') },
                ]}
              />
              {sel.files.length > 1 && (
                <Segmented<Output>
                  label={t('i2p.output')}
                  value={output}
                  onChange={setOutput}
                  options={[
                    { value: 'single', label: t('i2p.single') },
                    { value: 'each', label: t('i2p.each') },
                  ]}
                />
              )}
              <Button variant="primary" size="lg" icon="imageIn" className="w-full" onClick={convert} data-testid="run">
                {t('i2p.run')}
              </Button>
              <p className="text-sm text-muted">{t('i2p.note')}</p>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
