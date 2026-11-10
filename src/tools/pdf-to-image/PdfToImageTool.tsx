import { useEffect, useRef, useState } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { ToolFrame } from '../../components/ToolFrame'
import { Button, LocalBadge, Notice, Segmented, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useJob } from '../../components/useJob'
import { Icon } from '../../components/Icon'
import type { ToolDef } from '../registry'
import { deriveName } from '../../lib/files'
import type { OutputFile } from '../../lib/output'
import { canvasToBlob, closePdf, openPdf, PasswordRequiredError, releaseCanvas, renderPage } from '../../lib/render/pdfjs'
import type { FileKind } from '../../lib/validate'
import { CancelledError } from '../../lib/workerClient'
import { useI18n } from '../../i18n/context'

const ACCEPT: FileKind[] = ['pdf']
type Format = 'jpg' | 'png'
type Dpi = 72 | 150 | 300
type LockState = { status: 'checking' } | { status: 'open' } | { status: 'locked'; wrong?: boolean } | { status: 'unlocked'; password: string }

export default function PdfToImageTool({ tool }: { tool: ToolDef }) {
  const { t } = useI18n()
  const sel = useFiles(ACCEPT, { multiple: true })
  const job = useJob()
  const [format, setFormat] = useState<Format>(tool.slug === 'pdf-to-png' ? 'png' : 'jpg')
  const [dpi, setDpi] = useState<Dpi>(150)
  const [quality, setQuality] = useState<0.92 | 0.8>(0.92)
  const [locks, setLocks] = useState<Record<string, LockState>>({})
  const [pwInput, setPwInput] = useState<Record<string, string>>({})
  const startOver = () => { job.reset(); sel.clear(); setLocks({}); setPwInput({}); probed.current.clear() }

  // Files the pre-scan marked as encrypted are probed with PDF.js: permission-only protection opens
  // without a password, a user password needs to be entered. Unencrypted files need no probe.
  const probed = useRef(new Set<string>())
  useEffect(() => {
    for (const f of sel.files) {
      if (!f.encrypted || probed.current.has(f.id)) continue
      probed.current.add(f.id)
      ;(async () => {
        let state: LockState = { status: 'open' }
        try {
          await closePdf(await openPdf(await readBytes(f), { name: f.name }))
        } catch (e) {
          if (e instanceof PasswordRequiredError) state = { status: 'locked' }
        }
        setLocks((l) => ({ ...l, [f.id]: state }))
      })()
    }
  }, [sel.files])
  const lockOf = (f: (typeof sel.files)[number]): LockState => locks[f.id] ?? (f.encrypted ? { status: 'checking' } : { status: 'open' })

  const unlock = async (id: string) => {
    const f = sel.files.find((x) => x.id === id)
    const password = pwInput[id] ?? ''
    if (!f || !password) return
    try {
      const doc = await openPdf(await readBytes(f), { name: f.name, password })
      await closePdf(doc)
      setLocks((l) => ({ ...l, [id]: { status: 'unlocked', password } }))
    } catch {
      setLocks((l) => ({ ...l, [id]: { status: 'locked', wrong: true } }))
    }
  }

  const locked = sel.files.filter((f) => lockOf(f).status === 'locked')
  const checking = sel.files.some((f) => lockOf(f).status === 'checking')

  const convert = () =>
    job.run(async ({ signal, progress }) => {
      const out: OutputFile[] = []
      const mime = format === 'png' ? 'image/png' : 'image/jpeg'
      for (let fi = 0; fi < sel.files.length; fi++) {
        const f = sel.files[fi]
        const lock = lockOf(f)
        const password = lock?.status === 'unlocked' ? lock.password : undefined
        const doc = await openPdf(await readBytes(f), { name: f.name, password, forExport: true })
        try {
          const pad = String(doc.numPages).length
          for (let p = 1; p <= doc.numPages; p++) {
            if (signal.aborted) throw new CancelledError()
            const step = t('p2i.pageProgress', { page: p, total: doc.numPages })
            progress(
              (fi + (p - 1) / doc.numPages) / sel.files.length,
              sel.files.length > 1 ? { key: 'cmp.fileProgress', params: { name: f.name, step } } : { key: 'p2i.pageProgress', params: { page: p, total: doc.numPages } },
            )
            const { canvas, scaleUsed } = await renderPage(doc, p, dpi / 72)
            try {
              const blob = await canvasToBlob(canvas, mime, format === 'jpg' ? quality : undefined)
              const reduced = scaleUsed < dpi / 72 - 0.01
              out.push({
                name: deriveName(f.name, `-page-${String(p).padStart(pad, '0')}`, format),
                blob,
                note: { key: reduced ? 'p2i.dimsReduced' : 'p2i.dims', params: { w: canvas.width, h: canvas.height } },
              })
            } finally {
              releaseCanvas(canvas)
            }
          }
        } finally {
          await closePdf(doc)
        }
      }
      return out
    })

  return (
    <ToolFrame
      job={job}
      hasInput={sel.files.length > 0}
      rejections={sel.rejections}
      onDismissRejections={() => sel.setRejections([])}
      onStartOver={startOver}
      zipName={sel.files[0] ? deriveName(sel.files[0].name, `-${format}`, 'zip') : undefined}
      dropzone={<Dropzone accept={ACCEPT} multiple onFiles={sel.add} />}
      workspace={
        <Workspace
          main={
            <div className="space-y-3">
              <FileList
                files={sel.files}
                modifiesPdf={false}
                onRemove={sel.remove}
                extra={(f) => {
                  const s = lockOf(f).status
                  return s === 'locked' ? t('p2i.passwordNeeded') : s === 'unlocked' ? t('p2i.unlocked') : ''
                }}
              />
              {locked.map((f) => (
                <form
                  key={f.id}
                  onSubmit={(e) => { e.preventDefault(); unlock(f.id) }}
                  className="fade-in rounded-xl border border-line bg-surface p-4"
                >
                  <label className="mb-2 flex items-center gap-2 font-semibold" htmlFor={`pw-${f.id}`}>
                    <Icon name="lock" size={18} className="shrink-0 text-accent" /> <span dir="auto">{t('p2i.locked', { name: f.name })}</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      id={`pw-${f.id}`}
                      type="password"
                      autoComplete="off"
                      value={pwInput[f.id] ?? ''}
                      onChange={(e) => setPwInput((p) => ({ ...p, [f.id]: e.target.value }))}
                      className="h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-paper px-3 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
                      placeholder={t('p2i.pwPlaceholder')}
                    />
                    <Button type="submit" variant="secondary">{t('p2i.unlock')}</Button>
                  </div>
                  {(lockOf(f) as { wrong?: boolean }).wrong && <p className="mt-2 text-sm font-semibold text-danger" role="alert">{t('p2i.wrongPw')}</p>}
                  <p className="mt-2 text-sm text-muted">{t('p2i.pwNote')}</p>
                </form>
              ))}
              <Dropzone accept={ACCEPT} multiple compact onFiles={sel.add} />
            </div>
          }
          side={
            <>
              <Segmented<Format> label={t('p2i.format')} value={format} onChange={setFormat} options={[{ value: 'jpg', label: 'JPG', hint: t('p2i.jpgHint') }, { value: 'png', label: 'PNG', hint: t('p2i.pngHint') }]} />
              <Segmented<Dpi>
                label={t('p2i.resolution')}
                value={dpi}
                onChange={setDpi}
                options={[
                  { value: 72, label: t('p2i.low'), hint: t('p2i.dpi', { n: 72 }) },
                  { value: 150, label: t('p2i.medium'), hint: t('p2i.dpi', { n: 150 }) },
                  { value: 300, label: t('p2i.high'), hint: t('p2i.dpi', { n: 300 }) },
                ]}
              />
              {format === 'jpg' && (
                <Segmented<0.92 | 0.8> label={t('p2i.quality')} value={quality} onChange={setQuality} options={[{ value: 0.92, label: t('p2i.qHigh') }, { value: 0.8, label: t('p2i.qStd') }]} />
              )}
              {locked.length > 0 && <Notice tone="info">{t('p2i.unlockFirst', { count: locked.length })}</Notice>}
              <Button variant="primary" size="lg" icon="imageOut" className="w-full" disabled={locked.length > 0 || checking} onClick={convert} data-testid="run">
                {t('p2i.run', { fmt: format.toUpperCase() })}
              </Button>
              <p className="text-sm text-muted">{t('p2i.note')}</p>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
