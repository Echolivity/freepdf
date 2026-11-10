import { useState } from 'react'
import type { PDFDocumentProxy } from '../lib/render/pdfjs'
import { PageThumb } from './thumbs'
import { Icon } from './Icon'
import { useI18n } from '../i18n/context'

export interface GridPage {
  key: string
  /** 0-based index in the source document. */
  index: number
  rotation: number
}

/**
 * Thumbnail grid. Modes:
 *  - select: click/space toggles selection (Extract, Remove)
 *  - organize: drag or arrow buttons to reorder, per-page rotate/delete
 *  - view: read-only (with optional per-page label)
 */
export function PageGrid({
  doc,
  pages,
  mode,
  selected,
  onToggle,
  onMove,
  onRotate,
  onDelete,
  labelFor,
  selectTone = 'accent',
}: {
  doc: PDFDocumentProxy
  pages: GridPage[]
  mode: 'select' | 'organize' | 'view'
  selected?: Set<number>
  onToggle?: (index: number, shiftKey: boolean) => void
  onMove?: (from: number, to: number) => void
  onRotate?: (pos: number, delta: number) => void
  onDelete?: (pos: number) => void
  labelFor?: (page: GridPage, pos: number) => string | undefined
  selectTone?: 'accent' | 'danger'
}) {
  const { t } = useI18n()
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const ring = selectTone === 'danger' ? 'ring-danger' : 'ring-accent'

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" aria-label={t('pages.label')}>
      {pages.map((p, pos) => {
        const isSel = selected?.has(p.index) ?? false
        const label = labelFor?.(p, pos)
        const tile = (
          <>
            <div className={`relative rounded-lg p-2 transition-colors ${isSel ? (selectTone === 'danger' ? 'bg-danger-soft' : 'bg-accent-soft') : 'bg-surface-2'}`}>
              <div className={isSel && selectTone === 'danger' ? 'opacity-40' : ''}>
                <PageThumb doc={doc} pageNumber={p.index + 1} rotation={p.rotation} />
              </div>
              {mode === 'select' && (
                <span className={`absolute end-1 top-1 grid h-6 w-6 place-items-center rounded-full border-2 ${isSel ? `${selectTone === 'danger' ? 'border-danger bg-danger' : 'border-accent bg-accent'} text-on-accent` : 'border-line-strong bg-surface'}`}>
                  {isSel && <Icon name={selectTone === 'danger' ? 'x' : 'check'} size={14} strokeWidth={3} />}
                </span>
              )}
            </div>
            <span className="mt-1.5 flex items-center justify-center gap-1 text-sm">
              <span className="font-semibold">{p.index + 1}</span>
              {label && <span className="truncate text-muted">· {label}</span>}
            </span>
          </>
        )
        return (
          <li
            key={p.key}
            className={`group relative rounded-xl ${over === pos && drag !== pos ? 'ring-2 ring-accent' : ''} ${drag === pos ? 'opacity-40' : ''}`}
            draggable={mode === 'organize'}
            onDragStart={(e) => { setDrag(pos); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(pos)) }}
            onDragOver={(e) => { if (drag === null) return; e.preventDefault(); setOver(pos) }}
            onDrop={(e) => { e.preventDefault(); if (drag !== null) onMove?.(drag, pos); setDrag(null); setOver(null) }}
            onDragEnd={() => { setDrag(null); setOver(null) }}
          >
            {mode === 'select' ? (
              <button
                type="button"
                aria-pressed={isSel}
                aria-label={t('pages.page', { n: p.index + 1 })}
                onClick={(e) => onToggle?.(p.index, e.shiftKey)}
                className={`block w-full rounded-xl p-1 text-start ${isSel ? `ring-2 ${ring}` : 'hover:ring-2 hover:ring-line-strong'}`}
              >
                {tile}
              </button>
            ) : (
              <div className="p-1">{tile}</div>
            )}
            {mode === 'organize' && (
              <div className="absolute inset-x-1 top-1 flex justify-between gap-0.5 rounded-lg p-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                <span className="flex gap-0.5">
                  <TileBtn label={t('pages.earlier', { n: p.index + 1 })} icon="arrowLeft" disabled={pos === 0} onClick={() => onMove?.(pos, pos - 1)} />
                  <TileBtn label={t('pages.later', { n: p.index + 1 })} icon="arrowLeft" flip disabled={pos === pages.length - 1} onClick={() => onMove?.(pos, pos + 1)} />
                </span>
                <span className="flex gap-0.5">
                  <TileBtn label={t('pages.rotate', { n: p.index + 1 })} icon="rotate" onClick={() => onRotate?.(pos, 90)} />
                  <TileBtn label={t('pages.delete', { n: p.index + 1 })} icon="trash" danger disabled={pages.length === 1} onClick={() => onDelete?.(pos)} />
                </span>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function TileBtn({ label, icon, onClick, disabled, danger, flip }: { label: string; icon: 'arrowLeft' | 'rotate' | 'trash'; onClick: () => void; disabled?: boolean; danger?: boolean; flip?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-md border border-line bg-surface shadow-sm disabled:opacity-30 ${danger ? 'text-danger hover:bg-danger-soft' : 'text-ink hover:bg-surface-2'}`}
    >
      {/* "Earlier" points toward the start of the reading direction: left in English, right in Arabic. */}
      <Icon name={icon} size={15} className={icon === 'arrowLeft' ? (flip ? '-scale-x-100 rtl:scale-x-100' : 'rtl:-scale-x-100') : undefined} />
    </button>
  )
}
