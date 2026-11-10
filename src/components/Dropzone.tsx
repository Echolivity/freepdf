import { useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import type { FileKind } from '../lib/validate'
import { LIMITS, MB } from '../config'
import { useI18n } from '../i18n/react'

const ACCEPT: Record<FileKind, string> = {
  pdf: '.pdf,application/pdf',
  jpeg: '.jpg,.jpeg,image/jpeg',
  png: '.png,image/png',
  webp: '.webp,image/webp',
}
const LABEL: Record<FileKind, string> = { pdf: 'PDF', jpeg: 'JPG', png: 'PNG', webp: 'WebP' }

function hasFiles(e: DragEvent) {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}

export function Dropzone({
  accept,
  multiple,
  onFiles,
  compact = false,
}: {
  accept: FileKind[]
  multiple: boolean
  onFiles: (files: File[]) => void
  compact?: boolean
}) {
  const { t } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const kinds = accept.map((k) => LABEL[k]).join(', ')
  const isPdf = accept.length === 1 && accept[0] === 'pdf'
  const choose = () => input.current?.click()

  const picker = (
    <input
      ref={input}
      type="file"
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      accept={accept.map((k) => ACCEPT[k]).join(',')}
      multiple={multiple}
      data-testid="file-input"
      onChange={(e) => {
        const list = Array.from(e.target.files ?? [])
        e.target.value = '' // allow re-selecting the same file
        if (list.length) onFiles(list)
      }}
    />
  )

  const dragHandlers = {
    onDragEnter: (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current++; setOver(true) },
    onDragOver: (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy' },
    onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false) },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setOver(false)
      const list = Array.from(e.dataTransfer.files)
      if (list.length) onFiles(list)
    },
  }

  if (compact) {
    return (
      <div {...dragHandlers} className={`rounded-xl border-2 border-dashed transition-colors ${over ? 'border-accent bg-accent-soft' : 'border-line-strong'}`}>
        {picker}
        <button type="button" onClick={choose} className="flex w-full items-center justify-center gap-2 px-4 py-3 text-[15px] font-semibold text-muted hover:text-ink">
          <Icon name="plus" size={18} /> {over ? t('drop.dropNow') : t(isPdf ? 'drop.addMorePdfs' : 'drop.addMoreImages')}
        </button>
      </div>
    )
  }

  return (
    <div
      {...dragHandlers}
      className={`dot-grid relative flex flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-14 text-center transition-colors sm:py-20 ${
        over ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface-2'
      }`}
    >
      {picker}
      <span className="mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-accent text-on-accent shadow-[0_10px_30px_-12px_var(--accent)]">
        <Icon name="upload" size={30} />
      </span>
      <button
        type="button"
        onClick={choose}
        className="rounded-2xl bg-accent px-7 py-3.5 text-lg font-semibold text-on-accent transition-colors hover:bg-accent-hover"
      >
        {t(isPdf ? (multiple ? 'drop.selectPdfs' : 'drop.selectPdf') : multiple ? 'drop.selectImages' : 'drop.selectImage')}
      </button>
      <p className="mt-4 text-muted">
        {over ? t('drop.dropNow') : t(multiple ? 'drop.orMany' : 'drop.orOne')}
      </p>
      <p className="mt-6 text-sm text-muted">
        {t('drop.limits', { kinds, mb: LIMITS.maxFileBytes / MB })}
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-sm text-muted">
        <Icon name="shield" size={16} className="text-ok" />
        {t('drop.stays')}{' '}
        <Link to="/privacy" className="font-semibold underline decoration-line-strong underline-offset-4 hover:text-ink">{t('nav.how')}</Link>
      </p>
    </div>
  )
}
