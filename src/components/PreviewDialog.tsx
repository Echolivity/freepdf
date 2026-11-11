import { useEffect, useRef } from 'react'
import { usePdfFromBytes } from './usePdfFromBytes'
import { PageGrid } from './PageGrid'
import { Button } from './ui'
import { useI18n } from '../i18n/context'

/**
 * Full-document preview of a result before downloading it. The bytes shown are exactly the bytes that
 * get downloaded (nothing is processed twice).
 */
export function PreviewDialog({ bytes, onClose, onDownload, title }: { bytes: Uint8Array; title: string; onClose: () => void; onDownload: () => void }) {
  const { t } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)
  const { doc, failed } = usePdfFromBytes(bytes)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
    return () => d?.close()
  }, [])
  const count = doc?.numPages ?? 0
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="preview-title"
      className="m-auto max-h-[92vh] w-[min(64rem,94vw)] overflow-hidden rounded-2xl border border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-black/50"
      data-testid="preview-dialog"
    >
      <div className="flex max-h-[92vh] flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-5 py-4">
          <div>
            <h2 id="preview-title" className="text-xl font-semibold">{title}</h2>
            <p className="text-sm text-muted" data-testid="preview-count">{count ? t('preview.pages', { count }) : t('common.readingPages')}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => ref.current?.close()} data-testid="preview-close">{t('preview.back')}</Button>
            <Button variant="primary" icon="download" onClick={onDownload} data-testid="preview-download">{t('preview.download')}</Button>
          </div>
        </header>
        <div className="overflow-y-auto p-5">
          {failed && <p role="alert" className="text-danger">{t('preview.failed')}</p>}
          {doc && (
            <PageGrid
              doc={doc}
              mode="view"
              ariaLabel={t('preview.label')}
              pages={Array.from({ length: count }, (_, i) => ({ key: String(i), index: i, rotation: 0 }))}
            />
          )}
        </div>
      </div>
    </dialog>
  )
}
