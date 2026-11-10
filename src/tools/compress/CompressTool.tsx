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
import { useI18n } from '../../i18n/react'
import type { Message } from '../../i18n/core'

const ACCEPT: FileKind[] = ['pdf']

export default function CompressTool() {
  const { t, tm } = useI18n()
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
          {
            signal,
            onProgress: (v, l) =>
              progress(base + v / sel.files.length, sel.files.length > 1 && l ? { key: 'cmp.fileProgress', params: { name: f.name, step: tm(l) } } : l),
          },
        )
        before += res.originalSize
        after += res.bytes.length
        if (res.unchanged) unchanged++
        const saved = 1 - res.bytes.length / res.originalSize
        out.push({
          name: deriveName(f.name, res.unchanged ? '' : '-compressed', 'pdf'),
          blob: pdfBlob(res.bytes),
          note: res.unchanged
            ? { key: 'cmp.unchangedNote' }
            : { key: 'cmp.savedNote', params: { before: formatBytes(res.originalSize), after: formatBytes(res.bytes.length), pct: Math.round(saved * 100) } },
        })
      }
      const pct = before ? Math.round((1 - after / before) * 100) : 0
      const summary: Message =
        unchanged === sel.files.length
          ? { key: 'cmp.allUnchanged' }
          : { key: 'cmp.summary', params: { before: formatBytes(before), after: formatBytes(after), pct } }
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
                label={t('cmp.label')}
                value={level}
                onChange={setLevel}
                options={[
                  { value: 'light', label: t('cmp.light'), hint: t('cmp.lightHint') },
                  { value: 'balanced', label: t('cmp.balanced'), hint: t('cmp.balancedHint') },
                  { value: 'strong', label: t('cmp.strong'), hint: t('cmp.strongHint') },
                ]}
              />
              <p className="text-sm text-muted">{t(`cmp.explain.${level}`)}</p>
              <Button variant="primary" size="lg" icon="compress" className="w-full" onClick={compress} data-testid="run">
                {t('cmp.run', { count: sel.files.length })}
              </Button>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
