import { useEffect, useMemo, useRef, useState } from 'react'
import type { Job } from './useJob'
import { Button, Notice } from './ui'
import { Icon } from './Icon'
import { formatBytes } from '../lib/files'
import { downloadBlob, zipOutputs, type OutputFile } from '../lib/output'
import { useI18n } from '../i18n/context'

export function ProgressPanel({ job }: { job: Job }) {
  const { t, tm } = useI18n()
  const pct = Math.round(job.progress * 100)
  return (
    <div className="fade-in rounded-2xl border border-line bg-surface p-6 shadow-lift sm:p-7" role="status" aria-live="polite">
      <div className="mb-4 flex items-end justify-between gap-4">
        <p className="flex items-center gap-2.5 font-semibold" dir="auto">
          <span aria-hidden="true" className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inset-0 rounded-full bg-accent opacity-60 motion-safe:animate-ping" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-accent" />
          </span>
          {job.label ? tm(job.label) : t('job.working')}
        </p>
        <p className="font-display text-4xl font-semibold leading-none tabular-nums tracking-tight">{pct}<span className="text-xl text-muted">%</span></p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('job.progress')}>
        <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
      <div className="mt-5 flex items-center justify-between gap-4 border-t border-line pt-4">
        <p className="text-sm text-muted">{t('job.localNote')}</p>
        <Button variant="ghost" size="sm" onClick={job.cancel}>{t('job.cancel')}</Button>
      </div>
    </div>
  )
}

export function ResultPanel({ job, onStartOver, zipName = 'freepdf-files.zip' }: { job: Job; onStartOver: () => void; zipName?: string }) {
  const { t, tm } = useI18n()
  const files = job.results
  const heading = useRef<HTMLHeadingElement>(null)
  const [zipping, setZipping] = useState(false)
  const total = useMemo(() => files.reduce((s, f) => s + f.blob.size, 0), [files])

  useEffect(() => { heading.current?.focus() }, [])

  const downloadAll = async () => {
    setZipping(true)
    try {
      downloadBlob(await zipOutputs(files), zipName)
    } finally {
      setZipping(false)
    }
  }

  return (
    <section className="fade-in rounded-2xl border border-line bg-surface p-6 shadow-lift sm:p-8" aria-labelledby="result-h">
      <div className="flex flex-wrap items-center gap-4">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-ok-soft text-ok ring-1 ring-inset ring-ok/25"><Icon name="check" size={28} strokeWidth={2.4} /></span>
        <div className="min-w-0 flex-1">
          <h2 id="result-h" ref={heading} tabIndex={-1} className="text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
            {t('job.ready', { count: files.length })}
          </h2>
          <p className="text-muted">{job.summary ? tm(job.summary) : t('job.total', { size: formatBytes(total) })}</p>
        </div>
      </div>

      <div className="mt-7 flex flex-wrap gap-3">
        {files.length === 1 ? (
          <Button variant="primary" size="lg" icon="download" onClick={() => downloadBlob(files[0].blob, files[0].name)} data-testid="download">
            {t('job.download')}
          </Button>
        ) : (
          <Button variant="primary" size="lg" icon="zip" onClick={downloadAll} disabled={zipping} data-testid="download-zip">
            {zipping ? t('job.zipping') : t('job.downloadZip')}
          </Button>
        )}
        <Button size="lg" icon="refresh" onClick={onStartOver} data-testid="start-over">{t('job.startOver')}</Button>
      </div>

      {files.length > 1 && <OutputList files={files} />}
      {files.length === 1 && files[0].note && <p className="mt-4 text-sm text-muted" data-testid="file-note">{tm(files[0].note)}</p>}

      <p className="mt-6 border-t border-line pt-4 text-sm text-muted">
        {t('job.ephemeral')}
      </p>
    </section>
  )
}

function OutputList({ files }: { files: OutputFile[] }) {
  const { t, tm } = useI18n()
  return (
    <ul className="mt-6 max-h-96 divide-y divide-line overflow-auto rounded-xl border border-line bg-paper/50" aria-label={t('job.outputs')}>
      {files.map((f, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-2.5">
          <Icon name="file" size={18} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold" dir="auto">{f.name}</span>
            <span className="block text-sm text-muted"><bdi dir="ltr">{formatBytes(f.blob.size)}</bdi>{f.note ? ` · ${tm(f.note)}` : ''}</span>
          </span>
          <Button variant="ghost" size="sm" icon="download" onClick={() => downloadBlob(f.blob, f.name)} aria-label={t('job.downloadName', { name: f.name })}>
            <span className="hidden sm:inline">{t('job.download')}</span>
          </Button>
        </li>
      ))}
    </ul>
  )
}

/** Renders progress / error / result for a job; returns null while idle. */
export function JobStatus({ job, onStartOver, zipName }: { job: Job; onStartOver: () => void; zipName?: string }) {
  const { tm } = useI18n()
  if (job.status === 'running') return <ProgressPanel job={job} />
  if (job.status === 'done') return <ResultPanel job={job} onStartOver={onStartOver} zipName={zipName} />
  if (job.status === 'error') return <Notice tone="error">{tm(job.error)}</Notice>
  return null
}
