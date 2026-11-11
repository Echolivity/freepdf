import { useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import type { FileKind } from '../lib/validate'
import { LIMITS, MB } from '../config'
import { useI18n } from '../i18n/context'

const ACCEPT: Record<FileKind, string> = {
  pdf: '.pdf,application/pdf',
  jpeg: '.jpg,.jpeg,image/jpeg',
  png: '.png,image/png',
  webp: '.webp,image/webp',
  tiff: '.tif,.tiff,image/tiff',
  text: '.txt,.text,text/plain',
  docx: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  html: '.html,.htm,text/html',
}
const LABEL: Record<FileKind, string> = { pdf: 'PDF', jpeg: 'JPG', png: 'PNG', webp: 'WebP', tiff: 'TIFF', text: 'TXT', docx: 'DOCX', xlsx: 'XLSX', html: 'HTML' }

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
  // Single-format document inputs get their own wording ("Select Word files").
  const docKind = accept.length === 1 && ['text', 'docx', 'xlsx', 'html'].includes(accept[0]) ? (accept[0] as 'text' | 'docx' | 'xlsx' | 'html') : null
  const DOC_SELECT = { text: 'drop.selectTexts', docx: 'drop.selectWord', xlsx: 'drop.selectExcel', html: 'drop.selectHtml' } as const
  const DOC_MORE = { text: 'drop.addMoreTexts', docx: 'drop.addMoreWord', xlsx: 'drop.addMoreExcel', html: 'drop.addMoreHtml' } as const
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
      <div {...dragHandlers} className={`rounded-xl border-2 border-dashed transition-colors ${over ? 'border-accent bg-accent-soft' : 'border-line-strong hover:border-accent/60'}`}>
        {picker}
        <button type="button" onClick={choose} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[15px] font-semibold text-muted hover:text-ink">
          <Icon name="plus" size={18} /> {over ? t('drop.dropNow') : t(isPdf ? 'drop.addMorePdfs' : docKind ? DOC_MORE[docKind] : 'drop.addMoreImages')}
        </button>
      </div>
    )
  }

  return (
    <div {...dragHandlers} className="relative overflow-hidden rounded-[28px] border border-line bg-surface p-2 shadow-lift sm:p-3">
      {picker}
      <div
        className={`relative flex flex-col items-center justify-center overflow-hidden rounded-[22px] border-2 border-dashed px-6 py-12 text-center transition-colors duration-200 sm:py-16 ${
          over ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface-2/60'
        }`}
      >
        <div aria-hidden="true" className="dot-grid dot-grid-fade pointer-events-none absolute inset-0" />
        {/* Two sheets and an upload badge: what goes in, and that it stays here. */}
        <span aria-hidden="true" className={`relative mb-7 block h-24 w-28 transition-transform duration-300 ${over ? 'motion-safe:-translate-y-1 motion-safe:scale-105' : ''}`}>
          <span className="absolute start-1 top-2 h-[84px] w-16 -rotate-[8deg] rounded-lg border border-line-strong bg-surface shadow-card" />
          <span className="absolute end-3 top-0 h-[88px] w-[68px] rotate-[5deg] rounded-lg border border-line-strong bg-surface shadow-lift">
            <span className="absolute inset-x-3 top-4 h-1.5 rounded-full bg-ink/80" />
            <span className="absolute inset-x-3 top-8 h-1 rounded-full bg-line-strong" />
            <span className="absolute start-3 end-5 top-11 h-1 rounded-full bg-line-strong" />
            <span className="absolute inset-x-3 top-[3.6rem] h-1 rounded-full bg-line-strong" />
          </span>
          <span className="absolute -bottom-1 end-0 grid h-12 w-12 place-items-center rounded-2xl bg-accent text-on-accent shadow-glow ring-4 ring-surface-2">
            <Icon name="upload" size={24} strokeWidth={2} />
          </span>
        </span>
        <button
          type="button"
          onClick={choose}
          className="relative min-h-14 rounded-2xl bg-accent px-7 py-3.5 text-lg font-semibold text-on-accent shadow-glow transition-[background-color,transform] hover:bg-accent-hover motion-safe:active:translate-y-px"
        >
          {t(isPdf ? (multiple ? 'drop.selectPdfs' : 'drop.selectPdf') : docKind ? DOC_SELECT[docKind] : multiple ? 'drop.selectImages' : 'drop.selectImage')}
        </button>
        <p className="relative mt-4 text-muted">
          {over ? t('drop.dropNow') : t(multiple ? 'drop.orMany' : 'drop.orOne')}
        </p>
      </div>
      <div className="flex flex-col items-center gap-x-6 gap-y-2 px-4 pb-2 pt-4 text-center text-sm text-muted sm:flex-row sm:justify-between sm:px-5 sm:pb-1 sm:pt-3.5 sm:text-start">
        <p>{t('drop.limits', { kinds, mb: LIMITS.maxFileBytes / MB, job: LIMITS.maxJobBytes / MB })}</p>
        <p className="flex items-center gap-1.5">
          <Icon name="shield" size={16} className="shrink-0 text-ok" />
          <span>
            {t('drop.stays')}{' '}
            <Link to="/privacy" className="font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:text-accent">{t('nav.how')}</Link>
          </span>
        </p>
      </div>
    </div>
  )
}
