import { useEffect, useState } from 'react'
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

const ACCEPT: FileKind[] = ['pdf']
type Format = 'jpg' | 'png'
type Dpi = 72 | 150 | 300
type LockState = { status: 'checking' } | { status: 'open' } | { status: 'locked'; wrong?: boolean } | { status: 'unlocked'; password: string }

export default function PdfToImageTool({ tool }: { tool: ToolDef }) {
  const sel = useFiles(ACCEPT, { multiple: true })
  const job = useJob()
  const [format, setFormat] = useState<Format>(tool.slug === 'pdf-to-png' ? 'png' : 'jpg')
  const [dpi, setDpi] = useState<Dpi>(150)
  const [quality, setQuality] = useState<0.92 | 0.8>(0.92)
  const [locks, setLocks] = useState<Record<string, LockState>>({})
  const [pwInput, setPwInput] = useState<Record<string, string>>({})
  const startOver = () => { job.reset(); sel.clear(); setLocks({}); setPwInput({}) }

  // Detect password-protected PDFs as they are added (PDF.js decrypts locally once the password is given).
  useEffect(() => {
    for (const f of sel.files) {
      if (locks[f.id]) continue
      setLocks((l) => ({ ...l, [f.id]: { status: 'checking' } }))
      ;(async () => {
        try {
          const doc = await openPdf(await readBytes(f), { name: f.name })
          await closePdf(doc)
          setLocks((l) => ({ ...l, [f.id]: { status: 'open' } }))
        } catch (e) {
          setLocks((l) => ({ ...l, [f.id]: e instanceof PasswordRequiredError ? { status: 'locked' } : { status: 'open' } }))
        }
      })()
    }
  }, [sel.files, locks])

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

  const locked = sel.files.filter((f) => locks[f.id]?.status === 'locked')
  const checking = sel.files.some((f) => !locks[f.id] || locks[f.id].status === 'checking')

  const convert = () =>
    job.run(async ({ signal, progress }) => {
      const out: OutputFile[] = []
      const mime = format === 'png' ? 'image/png' : 'image/jpeg'
      for (let fi = 0; fi < sel.files.length; fi++) {
        const f = sel.files[fi]
        const lock = locks[f.id]
        const password = lock?.status === 'unlocked' ? lock.password : undefined
        const doc = await openPdf(await readBytes(f), { name: f.name, password, forExport: true })
        try {
          const pad = String(doc.numPages).length
          for (let p = 1; p <= doc.numPages; p++) {
            if (signal.aborted) throw new CancelledError()
            progress((fi + (p - 1) / doc.numPages) / sel.files.length, `${sel.files.length > 1 ? `${f.name}: ` : ''}page ${p} of ${doc.numPages}`)
            const { canvas, scaleUsed } = await renderPage(doc, p, dpi / 72)
            try {
              const blob = await canvasToBlob(canvas, mime, format === 'jpg' ? quality : undefined)
              const reduced = scaleUsed < dpi / 72 - 0.01
              out.push({
                name: deriveName(f.name, `-page-${String(p).padStart(pad, '0')}`, format),
                blob,
                note: `${canvas.width}×${canvas.height}px${reduced ? ' (reduced: page too large for full resolution)' : ''}`,
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
                onRemove={sel.remove}
                extra={(f) => {
                  const s = locks[f.id]?.status
                  return s === 'locked' ? ' · password needed' : s === 'unlocked' ? ' · unlocked' : ''
                }}
              />
              {locked.map((f) => (
                <form
                  key={f.id}
                  onSubmit={(e) => { e.preventDefault(); unlock(f.id) }}
                  className="fade-in rounded-xl border border-line bg-surface p-4"
                >
                  <label className="mb-2 flex items-center gap-2 font-semibold" htmlFor={`pw-${f.id}`}>
                    <Icon name="lock" size={18} className="text-accent" /> “{f.name}” is password-protected
                  </label>
                  <div className="flex gap-2">
                    <input
                      id={`pw-${f.id}`}
                      type="password"
                      autoComplete="off"
                      value={pwInput[f.id] ?? ''}
                      onChange={(e) => setPwInput((p) => ({ ...p, [f.id]: e.target.value }))}
                      className="h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-paper px-3 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
                      placeholder="Enter the document password"
                    />
                    <Button type="submit" variant="secondary">Unlock</Button>
                  </div>
                  {(locks[f.id] as { wrong?: boolean }).wrong && <p className="mt-2 text-sm font-semibold text-danger" role="alert">That password isn’t correct.</p>}
                  <p className="mt-2 text-sm text-muted">The password is used only in this tab to open the file and is never stored.</p>
                </form>
              ))}
              <Dropzone accept={ACCEPT} multiple compact onFiles={sel.add} />
            </div>
          }
          side={
            <>
              <Segmented<Format> label="Image format" value={format} onChange={setFormat} options={[{ value: 'jpg', label: 'JPG', hint: 'Smaller files' }, { value: 'png', label: 'PNG', hint: 'Lossless' }]} />
              <Segmented<Dpi>
                label="Resolution"
                value={dpi}
                onChange={setDpi}
                options={[
                  { value: 72, label: 'Low', hint: '72 DPI' },
                  { value: 150, label: 'Medium', hint: '150 DPI' },
                  { value: 300, label: 'High', hint: '300 DPI' },
                ]}
              />
              {format === 'jpg' && (
                <Segmented<0.92 | 0.8> label="JPG quality" value={quality} onChange={setQuality} options={[{ value: 0.92, label: 'High' }, { value: 0.8, label: 'Standard' }]} />
              )}
              {locked.length > 0 && <Notice tone="info">Unlock the protected file{locked.length > 1 ? 's' : ''} first, or remove {locked.length > 1 ? 'them' : 'it'}.</Notice>}
              <Button variant="primary" size="lg" icon="imageOut" className="w-full" disabled={locked.length > 0 || checking} onClick={convert} data-testid="run">
                Convert to {format.toUpperCase()}
              </Button>
              <p className="text-sm text-muted">One image per page. Several images download together as a ZIP.</p>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
