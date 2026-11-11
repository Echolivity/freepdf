import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { PDFDocumentProxy } from '../lib/render/pdfjs'
import { PageThumb } from './thumbs'
import { Icon, type IconName } from './Icon'
import { useI18n } from '../i18n/context'

export interface GridPage {
  key: string
  /** 0-based index in its source document. */
  index: number
  rotation: number
  /** Source document (0 = the main file). Pages from other files are rendered from `docFor`. */
  src?: number
}

/**
 * Thumbnail grid. Modes:
 *  - select: click/space toggles selection (Extract, Delete)
 *  - organize: reorder by dragging the grip (mouse, pen or touch) or with the arrow buttons (keyboard);
 *    per-page rotate, duplicate and delete; optional checkbox selection for bulk actions
 *  - view: read-only (with optional per-page label)
 */
export function PageGrid({
  doc,
  docFor,
  pages,
  mode,
  selected,
  onToggle,
  selectedKeys,
  onToggleKey,
  onMove,
  onRotate,
  onDelete,
  onDuplicate,
  labelFor,
  numberFor,
  selectTone = 'accent',
  ariaLabel,
}: {
  doc: PDFDocumentProxy
  docFor?: (page: GridPage) => PDFDocumentProxy | null
  pages: GridPage[]
  mode: 'select' | 'organize' | 'view'
  selected?: Set<number>
  onToggle?: (index: number, shiftKey: boolean) => void
  selectedKeys?: Set<string>
  onToggleKey?: (key: string, shiftKey: boolean) => void
  onMove?: (from: number, to: number) => void
  onRotate?: (pos: number, delta: number) => void
  onDelete?: (pos: number) => void
  onDuplicate?: (pos: number) => void
  labelFor?: (page: GridPage, pos: number) => string | undefined
  /** Number shown under the tile (default: the page's number in its source). */
  numberFor?: (page: GridPage, pos: number) => string
  selectTone?: 'accent' | 'danger'
  ariaLabel?: string
}) {
  const { t } = useI18n()
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
  const list = useRef<HTMLUListElement>(null)
  const ring = selectTone === 'danger' ? 'ring-danger' : 'ring-accent'

  // Pointer-based reordering: one code path for mouse, pen and touch (HTML5 drag-and-drop doesn't
  // work on touch screens). The grip captures the pointer; the tile under the pointer is the target.
  const onGripDown = (e: ReactPointerEvent, pos: number) => {
    if (e.button !== 0) return
    e.preventDefault()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic or already-released pointer */ }
    setDrag({ from: pos, over: pos })
  }
  const onGripMove = (e: ReactPointerEvent) => {
    if (!drag) return
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-pos]')
    if (el && list.current?.contains(el)) {
      const over = Number(el.dataset.pos)
      if (over !== drag.over) setDrag({ ...drag, over })
    }
    // Scroll the page when dragging near the top or bottom edge.
    const edge = 70
    if (e.clientY < edge) window.scrollBy(0, -12)
    else if (e.clientY > window.innerHeight - edge) window.scrollBy(0, 12)
  }
  const onGripUp = () => {
    if (drag && drag.over !== drag.from) onMove?.(drag.from, drag.over)
    setDrag(null)
  }

  return (
    <ul ref={list} className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" aria-label={ariaLabel ?? t('pages.label')}>
      {pages.map((p, pos) => {
        const isSel = mode === 'select' ? (selected?.has(p.index) ?? false) : (selectedKeys?.has(p.key) ?? false)
        const label = labelFor?.(p, pos)
        const number = numberFor ? numberFor(p, pos) : String(p.index + 1)
        const tileDoc = (p.src ? docFor?.(p) : null) ?? doc
        const name = t('pages.page', { n: number })
        const tile = (
          <>
            <div className={`relative rounded-lg p-2 transition-colors ${isSel ? (selectTone === 'danger' ? 'bg-danger-soft' : 'bg-accent-soft') : 'bg-surface-2'}`}>
              <div className={isSel && selectTone === 'danger' ? 'opacity-40' : ''}>
                <PageThumb doc={tileDoc} pageNumber={p.index + 1} rotation={p.rotation} />
              </div>
              {mode === 'select' && (
                <span className={`absolute end-1 top-1 grid h-6 w-6 place-items-center rounded-full border-2 ${isSel ? `${selectTone === 'danger' ? 'border-danger bg-danger' : 'border-accent bg-accent'} text-on-accent` : 'border-line-strong bg-surface'}`}>
                  {isSel && <Icon name={selectTone === 'danger' ? 'x' : 'check'} size={14} strokeWidth={3} />}
                </span>
              )}
            </div>
            <span className="mt-1.5 flex items-center justify-center gap-1 text-sm">
              <span className="font-semibold">{number}</span>
              {label && <span className="truncate text-muted">· {label}</span>}
            </span>
          </>
        )
        const dragging = drag?.from === pos
        const target = drag && drag.over === pos && drag.from !== pos
        return (
          <li key={p.key} data-pos={pos} className={`group relative rounded-xl ${target ? 'ring-2 ring-accent ring-offset-2 ring-offset-paper' : ''} ${dragging ? 'opacity-40' : ''}`}>
            {mode === 'select' ? (
              <button
                type="button"
                aria-pressed={isSel}
                aria-label={name}
                onClick={(e) => onToggle?.(p.index, e.shiftKey)}
                className={`block w-full rounded-xl p-1 text-start ${isSel ? `ring-2 ${ring}` : 'hover:ring-2 hover:ring-line-strong'}`}
              >
                {tile}
              </button>
            ) : (
              <div className={`rounded-xl p-1 ${isSel ? 'ring-2 ring-accent' : ''}`}>{tile}</div>
            )}
            {mode === 'organize' && (
              <>
                <div className="absolute inset-x-1 top-1 flex justify-between gap-0.5 rounded-lg p-1">
                  <span className="flex gap-0.5">
                    <button
                      type="button"
                      title={t('pages.drag', { n: number })}
                      aria-label={t('pages.drag', { n: number })}
                      onPointerDown={(e) => onGripDown(e, pos)}
                      onPointerMove={onGripMove}
                      onPointerUp={onGripUp}
                      onPointerCancel={() => setDrag(null)}
                      onKeyDown={(e) => {
                        // Keyboard users reorder with the arrow keys on the grip.
                        const prev = document.documentElement.dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
                        const next = document.documentElement.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
                        if (e.key === prev && pos > 0) { e.preventDefault(); onMove?.(pos, pos - 1) }
                        if (e.key === next && pos < pages.length - 1) { e.preventDefault(); onMove?.(pos, pos + 1) }
                      }}
                      className="grid h-8 w-8 cursor-grab touch-none place-items-center rounded-md border border-line bg-surface text-muted shadow-sm active:cursor-grabbing"
                      data-testid={`grip-${pos}`}
                    >
                      <Icon name="grip" size={16} />
                    </button>
                  </span>
                  {onToggleKey && (
                    <label className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border border-line bg-surface shadow-sm" title={t('pages.select', { n: number })}>
                      <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={isSel} onChange={(e) => onToggleKey(p.key, (e.nativeEvent as MouseEvent).shiftKey === true)} aria-label={t('pages.select', { n: number })} />
                    </label>
                  )}
                </div>
                <div className="absolute inset-x-0 bottom-8 flex justify-center gap-0.5 p-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                  <TileBtn label={t('pages.earlier', { n: number })} icon="arrowLeft" disabled={pos === 0} onClick={() => onMove?.(pos, pos - 1)} />
                  <TileBtn label={t('pages.rotate', { n: number })} icon="rotate" onClick={() => onRotate?.(pos, 90)} />
                  {onDuplicate && <TileBtn label={t('pages.duplicate', { n: number })} icon="copy" onClick={() => onDuplicate(pos)} />}
                  <TileBtn label={t('pages.delete', { n: number })} icon="trash" danger disabled={pages.length === 1} onClick={() => onDelete?.(pos)} />
                  <TileBtn label={t('pages.later', { n: number })} icon="arrowLeft" flip disabled={pos === pages.length - 1} onClick={() => onMove?.(pos, pos + 1)} />
                </div>
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function TileBtn({ label, icon, onClick, disabled, danger, flip }: { label: string; icon: IconName; onClick: () => void; disabled?: boolean; danger?: boolean; flip?: boolean }) {
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
