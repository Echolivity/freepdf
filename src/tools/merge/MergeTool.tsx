import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { ToolFrame } from '../../components/ToolFrame'
import { Button, LocalBadge, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useJob } from '../../components/useJob'
import { deriveName, formatBytes } from '../../lib/files'
import { pdfBlob } from '../../lib/output'
import type { FileKind } from '../../lib/validate'
import { runInWorker } from '../../lib/workerClient'
import { useI18n } from '../../i18n/context'

const ACCEPT: FileKind[] = ['pdf']

export default function MergeTool() {
  const { t } = useI18n()
  const sel = useFiles(ACCEPT, { multiple: true })
  const job = useJob()
  const startOver = () => { job.reset(); sel.clear() }

  const merge = () =>
    job.run(async ({ signal, progress }) => {
      progress(0, { key: 'prog.reading' })
      const files = await Promise.all(sel.files.map(async (f) => ({ name: f.name, bytes: await readBytes(f) })))
      const out = await runInWorker('merge', { files }, { signal, onProgress: progress })
      return [{ name: deriveName(files[0].name, '-merged', 'pdf'), blob: pdfBlob(out) }]
    })

  const total = sel.files.reduce((s, f) => s + f.size, 0)

  return (
    <ToolFrame
      job={job}
      hasInput={sel.files.length > 0}
      rejections={sel.rejections}
      onDismissRejections={() => sel.setRejections([])}
      onStartOver={startOver}
      dropzone={<Dropzone accept={ACCEPT} multiple onFiles={sel.add} />}
      workspace={
        <Workspace
          main={
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted">{t('merge.hint')}</p>
                <Button variant="ghost" size="sm" onClick={sel.sortByName}>{t('common.sortAZ')}</Button>
              </div>
              <FileList files={sel.files} reorderable onMove={sel.move} onRemove={sel.remove} />
              <Dropzone accept={ACCEPT} multiple compact onFiles={sel.add} />
            </div>
          }
          side={
            <>
              <div>
                <p className="font-display text-3xl font-semibold">
                  {sel.files.length} <span className="text-lg text-muted">{t('merge.unit', { count: sel.files.length })}</span>
                </p>
                <p className="text-sm text-muted">{t('common.totalSize', { size: formatBytes(total) })}</p>
              </div>
              {sel.files.length < 2 && <p className="text-sm text-muted">{t('merge.needMore')}</p>}
              <Button variant="primary" size="lg" icon="merge" className="w-full" disabled={sel.files.length < 2} onClick={merge} data-testid="run">
                {t('merge.run')}
              </Button>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
