import { useEffect, useRef, useState } from 'react'
import type { NamedBytes } from '../lib/pdf/core'
import type { ValidatedFile } from '../lib/validate'
import { runInWorker } from '../lib/workerClient'
import { usePdfFromBytes } from './usePdfFromBytes'
import { PageThumb } from './thumbs'
import { Button } from './ui'
import { Icon } from './Icon'
import { readBytes } from './useFiles'
import { useI18n } from '../i18n/context'

/**
 * WYSIWYG preview for tools that draw onto pages: the page being previewed is extracted once as a
 * one-page PDF, and the real operation runs on that small file whenever the settings change (debounced).
 * What you see is produced by the same code that produces the download.
 */
export function LivePreview({
  file,
  count,
  page,
  onPage,
  make,
  settingsKey,
}: {
  file: ValidatedFile
  count: number
  page: number
  onPage: (p: number) => void
  /** Apply the operation to the one-page sample; null = this page is left unchanged. */
  make: (sample: NamedBytes, page: number) => Promise<Uint8Array> | null
  /** Changes whenever the result could change (serialised settings). */
  settingsKey: string
}) {
  const { t } = useI18n()
  const [sample, setSample] = useState<{ key: string; bytes: Uint8Array } | null>(null)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [failed, setFailed] = useState(false)
  const makeRef = useRef(make)
  useEffect(() => { makeRef.current = make })
  const sampleKey = `${file.id}:${page}`

  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const bytes = await runInWorker('extract', { file: { name: file.name, bytes: await readBytes(file) }, indices: [page] })
        if (!dead) setSample({ key: sampleKey, bytes })
      } catch {
        if (!dead) setFailed(true)
      }
    })()
    return () => { dead = true }
  }, [file, page, sampleKey])

  useEffect(() => {
    if (!sample || sample.key !== sampleKey) return
    let dead = false
    const timer = setTimeout(async () => {
      try {
        const job = makeRef.current({ name: file.name, bytes: sample.bytes.slice() }, page)
        const out = job ? await job : sample.bytes
        if (!dead) { setResult(out); setFailed(false) }
      } catch {
        if (!dead) setFailed(true)
      }
    }, 250)
    return () => { dead = true; clearTimeout(timer) }
  }, [sample, sampleKey, settingsKey, file, page])

  const { doc } = usePdfFromBytes(result)
  return (
    <figure className="rounded-2xl border border-line bg-surface p-4" data-testid="live-preview">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button size="sm" variant="ghost" onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0} aria-label={t('cpr.prev')}>
          <Icon name="arrowLeft" size={18} className="rtl:-scale-x-100" />
        </Button>
        <figcaption className="text-sm font-semibold tabular-nums" data-testid="preview-page">{t('preview.pageOf', { page: page + 1, total: count })}</figcaption>
        <Button size="sm" variant="ghost" onClick={() => onPage(Math.min(count - 1, page + 1))} disabled={page >= count - 1} aria-label={t('cpr.next')}>
          <Icon name="arrowLeft" size={18} className="-scale-x-100 rtl:scale-x-100" />
        </Button>
      </div>
      <div className="mx-auto max-w-md" aria-live="polite">
        {doc ? <PageThumb key={page} doc={doc} pageNumber={1} width={448} /> : <div className="aspect-[1/1.414] animate-pulse rounded bg-surface-2" />}
      </div>
      {failed && <p className="mt-2 text-center text-sm text-muted">{t('preview.failed')}</p>}
    </figure>
  )
}
