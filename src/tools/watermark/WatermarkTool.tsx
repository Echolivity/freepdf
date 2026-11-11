import { useEffect, useMemo, useState } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { LivePreview } from '../../components/LivePreview'
import { ToolFrame } from '../../components/ToolFrame'
import { Button, LocalBadge, Notice, Rejections, Segmented, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useJob } from '../../components/useJob'
import { usePdfDoc } from '../../components/usePdfDoc'
import { deriveName } from '../../lib/files'
import { pdfBlob } from '../../lib/output'
import type { FontFamily } from '../../lib/pdf/fonts'
import type { Anchor, WatermarkOptions } from '../../lib/pdf/stamp'
import { parsePageSet } from '../../lib/ranges'
import { UserFacingError, type FileKind } from '../../lib/validate'
import { runInWorker } from '../../lib/workerClient'
import { useI18n } from '../../i18n/context'
import type { Message } from '../../i18n/core'
import { FontPicker, field } from '../stamp-ui'

const ACCEPT: FileKind[] = ['pdf']
const IMAGES: FileKind[] = ['jpeg', 'png']
const ANCHORS: Anchor[] = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br']

export default function WatermarkTool() {
  const { t, tm } = useI18n()
  const sel = useFiles(ACCEPT, { multiple: false })
  const img = useFiles(IMAGES, { multiple: false })
  const file = sel.files[0] ?? null
  const imageFile = img.files[0] ?? null
  const { doc, error: docError, loading } = usePdfDoc(file)
  const job = useJob()
  const count = doc?.numPages ?? 0
  const [kind, setKind] = useState<'text' | 'image'>('text')
  const [text, setText] = useState('')
  const [font, setFont] = useState<FontFamily>('helvetica')
  const [bold, setBold] = useState(true)
  const [size, setSize] = useState('48')
  const [color, setColor] = useState('#c62828')
  const [imageScale, setImageScale] = useState(30)
  const [anchor, setAnchor] = useState<Anchor>('mc')
  const [rotation, setRotation] = useState(45)
  const [opacity, setOpacity] = useState(30)
  const [tiled, setTiled] = useState(false)
  const [layer, setLayer] = useState<'over' | 'under'>('over')
  const [pagesText, setPagesText] = useState('')
  const [page, setPage] = useState(0)
  const [imageBytes, setImageBytes] = useState<{ file: unknown; bytes: Uint8Array } | null>(null)

  const [pageFor, setPageFor] = useState(file)
  if (pageFor !== file) { setPageFor(file); setPage(0) }

  useEffect(() => {
    if (!imageFile) return
    let dead = false
    readBytes(imageFile).then((bytes) => { if (!dead) setImageBytes({ file: imageFile, bytes }) })
    return () => { dead = true }
  }, [imageFile])
  const image = imageFile && imageBytes?.file === imageFile ? { bytes: imageBytes.bytes, kind: imageFile.kind === 'png' ? 'png' as const : 'jpeg' as const } : null

  const pages = useMemo((): { indices: number[] | null; error: Message | null } => {
    if (!pagesText.trim()) return { indices: null, error: null }
    try {
      return { indices: parsePageSet(pagesText, count), error: null }
    } catch (e) {
      return { indices: null, error: e instanceof UserFacingError ? e.toMessage() : { key: 'rng.empty' } }
    }
  }, [pagesText, count])

  const sizeN = Number(size.replace(',', '.'))
  const optsError: Message | null =
    kind === 'text' && !text.trim() ? { key: 'err.stampText' } : kind === 'image' && !image ? { key: 'err.stampImage' } : kind === 'text' && !(sizeN >= 4 && sizeN <= 400) ? { key: 'err.stampSize' } : null
  const options: WatermarkOptions = {
    kind, text, font, bold, size: sizeN, color, image, imageScale: imageScale / 100, anchor, rotation, opacity: opacity / 100,
    tiled, gap: Math.max(24, sizeN), layer, indices: pages.indices,
  }
  const targeted = pages.indices ? pages.indices.length : count
  const invalid = !doc || !!pages.error || !!optsError || !targeted
  // The image bytes are large: key the preview on the file, not its contents.
  const settingsKey = JSON.stringify({ ...options, image: imageFile?.id ?? null })

  const run = () =>
    job.run(async ({ signal, progress }) => {
      if (!file) return []
      const out = await runInWorker('watermark', { file: { name: file.name, bytes: await readBytes(file) }, options: { ...options, image: image && { ...image, bytes: image.bytes.slice() } } }, { signal, onProgress: progress })
      return [{ name: deriveName(file.name, '-watermarked', 'pdf'), blob: pdfBlob(out), note: { key: 'note.watermarked', params: { count: targeted } } }]
    })
  const startOver = () => { job.reset(); sel.clear(); img.clear() }
  const anchorLabel = (a: Anchor) => t(`wm.anchor.${a}`)

  return (
    <ToolFrame
      job={job}
      hasInput={!!file}
      rejections={sel.rejections}
      onDismissRejections={() => sel.setRejections([])}
      onStartOver={startOver}
      dropzone={<Dropzone accept={ACCEPT} multiple={false} onFiles={sel.add} />}
      workspace={
        <Workspace
          main={
            <div className="space-y-4">
              {file && <FileList files={[file]} onRemove={startOver} extra={() => (count ? t('files.pages', { count }) : '')} />}
              {docError && <Notice tone="error">{tm(docError)}</Notice>}
              {loading && <p className="text-muted" role="status">{t('common.readingPages')}</p>}
              {doc && file && (
                <LivePreview
                  file={file}
                  count={count}
                  page={page}
                  onPage={setPage}
                  settingsKey={settingsKey}
                  make={(sample, p) => {
                    if (optsError || (pages.indices && !pages.indices.includes(p))) return null
                    return runInWorker('watermark', { file: sample, options: { ...options, image: image && { ...image, bytes: image.bytes.slice() }, indices: null } })
                  }}
                />
              )}
            </div>
          }
          side={
            <>
              <Segmented<'text' | 'image'> label={t('wm.kind')} value={kind} onChange={setKind} options={[{ value: 'text', label: t('wm.kind.text') }, { value: 'image', label: t('wm.kind.image') }]} />
              {kind === 'text' ? (
                <>
                  <label className="block"><span className="mb-1.5 block text-sm font-semibold">{t('wm.textLabel')}</span>
                    <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('wm.textPlaceholder')} dir="auto" className={field} data-testid="wm-text" /></label>
                  <FontPicker font={font} onFont={setFont} bold={bold} onBold={setBold} size={size} onSize={setSize} color={color} onColor={setColor} />
                </>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">{t('wm.imageLabel')}</p>
                  <Rejections items={img.rejections} onDismiss={() => img.setRejections([])} />
                  {imageFile ? <FileList files={[imageFile]} onRemove={() => img.clear()} modifiesPdf={false} /> : <Dropzone accept={IMAGES} multiple={false} compact onFiles={img.add} />}
                  <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">{t('wm.imageScale', { value: imageScale })}</span>
                    <input type="range" min={5} max={100} step={5} value={imageScale} onChange={(e) => setImageScale(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" data-testid="wm-scale" /></label>
                </div>
              )}
              <Segmented<'single' | 'tiled'> label={t('wm.layout')} value={tiled ? 'tiled' : 'single'} onChange={(v) => setTiled(v === 'tiled')} options={[{ value: 'single', label: t('wm.single') }, { value: 'tiled', label: t('wm.tiled') }]} />
              {!tiled && (
                <fieldset>
                  <legend className="mb-1.5 text-sm font-semibold">{t('wm.position')}</legend>
                  {/* Physical page positions: the grid stays left-to-right in Arabic too. */}
                  <div dir="ltr" className="grid w-36 grid-cols-3 gap-1.5" role="radiogroup" aria-label={t('wm.position')}>
                    {ANCHORS.map((a) => (
                      <button key={a} type="button" role="radio" aria-checked={anchor === a} aria-label={anchorLabel(a)} title={anchorLabel(a)} onClick={() => setAnchor(a)}
                        className={`grid h-10 place-items-center rounded-lg border ${anchor === a ? 'border-accent bg-accent text-on-accent' : 'border-line-strong bg-paper hover:bg-surface-2'}`} data-testid={`anchor-${a}`}>
                        <span className={`h-2 w-2 rounded-full ${anchor === a ? 'bg-on-accent' : 'bg-muted'}`} />
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}
              <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">{t('wm.rotation', { value: rotation })}</span>
                <input type="range" min={-90} max={90} step={5} value={rotation} onChange={(e) => setRotation(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" data-testid="wm-rotation" /></label>
              <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">{t('wm.opacity', { value: opacity })}</span>
                <input type="range" min={5} max={100} step={5} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" data-testid="wm-opacity" /></label>
              <Segmented<'over' | 'under'> label={t('wm.layer')} value={layer} onChange={setLayer} options={[{ value: 'over', label: t('wm.over') }, { value: 'under', label: t('wm.under'), hint: t('wm.underHint') }]} />
              <label className="block"><span className="mb-1 block text-sm font-semibold">{t('pn.pages')}</span>
                <input value={pagesText} onChange={(e) => setPagesText(e.target.value)} placeholder={t('rs.pagesAll')} dir="ltr" inputMode="numeric" className={field} data-testid="ranges" /></label>
              {pages.error && <p className="text-sm font-semibold text-danger" role="alert">{tm(pages.error)}</p>}
              {doc && optsError && (kind === 'image' || text.length > 0 || optsError.key !== 'err.stampText') && <p className="text-sm font-semibold text-danger" role="alert">{tm(optsError)}</p>}
              <p className="text-xs text-muted">{t('wm.note')}</p>
              <Button variant="primary" size="lg" icon="stamp" className="w-full" disabled={invalid} onClick={run} data-testid="run">{t('wm.run')}</Button>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
