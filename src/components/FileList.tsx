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
}: {
  files: ValidatedFile[]
  onRemove: (id: string) => void
  onMove?: (from: number, to: number) => void
  reorderable?: boolean
  extra?: (f: ValidatedFile) => ReactNode
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
            <span className="block truncate font-semibold" title={f.name} dir="auto">{f.name}</span>
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
    </>
  )
}
