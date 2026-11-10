import { useState } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { ToolFrame } from '../../components/ToolFrame'
import { Button, LocalBadge, Segmented, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useJob } from '../../components/useJob'
import { deriveName, formatBytes } from '../../lib/files'
import { pdfBlob, type OutputFile } from '../../lib/output'
import type { CompressionLevel, SkipReason } from '../../lib/pdf/compress'
import type { FileKind } from '../../lib/validate'
import { runInWorker } from '../../lib/workerClient'
import { useI18n } from '../../i18n/react'
import type { Message } from '../../i18n/core'

const ACCEPT: FileKind[] = ['pdf']

export default function CompressTool() {
  const { t, tm, lang } = useI18n()
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
        const { report } = res
        const skipEntries = (Object.entries(report.skipped) as [SkipReason, number][]).filter(([, n]) => n > 0)
        const skippedCount = skipEntries.reduce((a, [, n]) => a + n, 0)
        // Honest per-file report: sizes, what was re-encoded, and what was left alone and why.
        out.push({
          name: deriveName(f.name, res.unchanged ? '' : '-compressed', 'pdf'),
          blob: pdfBlob(res.bytes),
          note: {
            key: 'cmp.note',
            params: {
              size: res.unchanged
                ? t('cmp.unchangedNote')
                : t('cmp.savedNote', { before: formatBytes(res.originalSize), after: formatBytes(res.bytes.length), pct: Math.round(saved * 100) }),
              images: report.images ? t('cmp.images', { count: report.images, done: res.unchanged ? 0 : report.recompressed }) : t('cmp.noImages'),
              skipped: skippedCount
                ? t('cmp.skipped', { count: skippedCount, reasons: skipEntries.map(([r, n]) => `${t(`cmp.skip.${r}`)}${n > 1 ? ` ×${n}` : ''}`).join(lang === 'ar' ? '، ' : ', ') })
                : '',
            },
          },
        })
      }
      const pct = before ? Math.round((1 - after / before) * 100) : 0
      // One file: its own note already reports sizes. Several files (or nothing gained): add a summary.
      const summary: Message | undefined =
        unchanged === sel.files.length
          ? { key: 'cmp.allUnchanged' }
          : sel.files.length > 1
            ? { key: 'cmp.summary', params: { before: formatBytes(before), after: formatBytes(after), pct } }
            : undefined
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
