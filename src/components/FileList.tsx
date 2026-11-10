import { useState, type ReactNode } from 'react'
import type { ValidatedFile } from '../lib/validate'
import { formatBytes } from '../lib/files'
import { LIMITS, LOW_MEMORY } from '../config'
import { Icon } from './Icon'
import { FileThumb } from './thumbs'
import { useI18n } from '../i18n/react'

export function FileList({
  files,
  onRemove,
  onMove,
  reorderable = false,
  extra,
  modifiesPdf = true,
}: {
  files: ValidatedFile[]
  onRemove: (id: string) => void
  onMove?: (from: number, to: number) => void
  reorderable?: boolean
  extra?: (f: ValidatedFile) => ReactNode
  /** Tools that rewrite the PDF warn about signatures and can't open protected files. */
  modifiesPdf?: boolean
}) {
  const { t } = useI18n()
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const total = files.reduce((s, f) => s + f.size, 0)
  return (
    <>
    {total > LIMITS.warnJobBytes && (
      <p role="status" className="mb-2 flex items-start gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-muted">
        <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-accent" />
        {t(LOW_MEMORY ? 'files.bigWarningLow' : 'files.bigWarning', { size: formatBytes(total) })}
      </p>
    )}
    <ol className="space-y-2" aria-label={t('files.label')}>
      {files.map((f, i) => (
        <li
          key={f.id}
          draggable={reorderable}
          onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)) }}
          onDragOver={(e) => { if (dragIndex === null) return; e.preventDefault(); setOverIndex(i) }}
          onDrop={(e) => { e.preventDefault(); if (dragIndex !== null && onMove) onMove(dragIndex, i); setDragIndex(null); setOverIndex(null) }}
          onDragEnd={() => { setDragIndex(null); setOverIndex(null) }}
          className={`fade-in flex items-center gap-3 rounded-xl border bg-surface p-2.5 pr-3 transition-colors ${
            overIndex === i && dragIndex !== i ? 'border-accent' : 'border-line'
          } ${dragIndex === i ? 'opacity-50' : ''}`}
        >
          {reorderable && (
            <span className="hidden cursor-grab text-muted sm:block" aria-hidden="true"><Icon name="grip" size={18} /></span>
          )}
          {reorderable && <span className="w-6 text-center font-display text-sm font-semibold text-muted">{i + 1}</span>}
          <span className="grid h-14 w-11 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-2">
            <FileThumb file={f} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate font-semibold" title={f.name} dir="auto">{f.name}</span>
              {f.signed && <span className="shrink-0 rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent">{t('files.signedBadge')}</span>}
              {f.encrypted && <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-semibold text-muted">{t('files.lockedBadge')}</span>}
            </span>
            <span className="block text-sm text-muted"><bdi dir="ltr">{formatBytes(f.size)}</bdi>{extra?.(f)}</span>
          </span>
          {reorderable && onMove && (
            <span className="flex">
              <button type="button" className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30" disabled={i === 0} onClick={() => onMove(i, i - 1)} aria-label={t('files.moveUp', { name: f.name })}>
                <Icon name="arrowUp" size={18} />
              </button>
              <button type="button" className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30" disabled={i === files.length - 1} onClick={() => onMove(i, i + 1)} aria-label={t('files.moveDown', { name: f.name })}>
                <Icon name="arrowDown" size={18} />
              </button>
            </span>
          )}
          <button type="button" className="rounded-lg p-2 text-muted hover:bg-danger-soft hover:text-danger" onClick={() => onRemove(f.id)} aria-label={t('files.remove', { name: f.name })}>
            <Icon name="x" size={18} />
          </button>
        </li>
      ))}
    </ol>
    {modifiesPdf && files.some((f) => f.signed || f.encrypted) && (
      <div className="mt-2 space-y-2" data-testid="file-warnings">
        {files.filter((f) => f.signed && !f.encrypted).map((f) => (
          <p key={`s${f.id}`} role="note" className="flex items-start gap-2 rounded-xl border border-accent/30 bg-accent-soft px-3 py-2 text-sm">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-accent" />
            <span>{t('files.signed', { name: f.name })}</span>
          </p>
        ))}
        {files.filter((f) => f.encrypted).map((f) => (
          <p key={`e${f.id}`} role="note" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm">
            <Icon name="lock" size={18} className="mt-0.5 shrink-0 text-danger" />
            <span>{t('files.encrypted', { name: f.name })}</span>
          </p>
        ))}
      </div>
    )}
    </>
  )
}
