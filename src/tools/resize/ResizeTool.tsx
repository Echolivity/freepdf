import { useEffect, useMemo, useState } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { ToolFrame } from '../../components/ToolFrame'
import { PageThumb } from '../../components/thumbs'
import { Button, LocalBadge, Segmented, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useJob } from '../../components/useJob'
import { usePdfDoc } from '../../components/usePdfDoc'
import { deriveName } from '../../lib/files'
import { pdfBlob, type OutputFile } from '../../lib/output'
import { PAPER, planPage, type Orientation, type PaperName, type ResizeMode, type ResizeOptions } from '../../lib/pdf/resizePlan'
import { parsePageSet } from '../../lib/ranges'
import { UserFacingError, type FileKind } from '../../lib/validate'
import { runInWorker } from '../../lib/workerClient'
import { useI18n } from '../../i18n/context'
import type { Message } from '../../i18n/core'

const ACCEPT: FileKind[] = ['pdf']
type Size = PaperName | 'custom'
type Unit = 'mm' | 'in'
const PT: Record<Unit, number> = { mm: 72 / 25.4, in: 72 }
const SIZES: Size[] = ['a4', 'letter', 'a3', 'a5', 'legal', 'custom']

const fieldCls = 'h-11 w-full rounded-xl border border-line-strong bg-paper px-3 tabular-nums focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15'

export default function ResizeTool() {
  const { t, tm } = useI18n()
  const sel = useFiles(ACCEPT, { multiple: true })
  const job = useJob()
  const single = sel.files.length === 1 ? sel.files[0] : null
  const { doc } = usePdfDoc(sel.files[0] ?? null)
  const [size, setSize] = useState<Size>('a4')
  const [unit, setUnit] = useState<Unit>('mm')
  const [custom, setCustom] = useState({ w: '210', h: '297' })
  const [orientation, setOrientation] = useState<Orientation>('auto')
  const [mode, setMode] = useState<ResizeMode>('fit')
  const [margin, setMargin] = useState('0')
  const [pagesText, setPagesText] = useState('')
  const [first, setFirst] = useState<{ box: { x: number; y: number; width: number; height: number }; rotation: number } | null>(null)

  // Page 1 geometry for the preview.
  useEffect(() => {
    if (!doc) return
    let dead = false
    doc.getPage(1).then((p) => {
      const [x0, y0, x1, y1] = p.view
      if (!dead) setFirst({ box: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, rotation: p.rotate })
      p.cleanup()
    }).catch(() => {})
    return () => { dead = true }
  }, [doc])

  const target = useMemo((): { w: number; h: number } | null => {
    if (size !== 'custom') return { w: PAPER[size][0], h: PAPER[size][1] }
    const w = Number(custom.w.replace(',', '.')) * PT[unit]
    const h = Number(custom.h.replace(',', '.')) * PT[unit]
    return w >= 72 && h >= 72 && w <= 14_400 && h <= 14_400 ? { w, h } : null
  }, [size, custom, unit])

  const marginPt = Math.max(0, Number(margin.replace(',', '.')) || 0) * PT.mm
  const count = doc?.numPages ?? 0
  const pages = useMemo((): { indices: number[] | null; error: Message | null } => {
    if (!single || !pagesText.trim()) return { indices: null, error: null }
    try {
      return { indices: parsePageSet(pagesText, count), error: null }
    } catch (e) {
      return { indices: null, error: e instanceof UserFacingError ? e.toMessage() : { key: 'rng.empty' } }
    }
  }, [single, pagesText, count])

  const options = useMemo((): ResizeOptions | null => (target ? { width: target.w, height: target.h, orientation, mode, margin: mode === 'canvas' ? 0 : marginPt, indices: pages.indices } : null), [target, orientation, mode, marginPt, pages.indices])

  const preview = useMemo(() => {
    if (!first || !options) return null
    try {
      const plan = planPage(first.box, first.rotation, options)
      const quarter = first.rotation % 180 !== 0
      const tw = quarter ? plan.height : plan.width
      const th = quarter ? plan.width : plan.height
      const vw = (quarter ? first.box.height : first.box.width) * plan.scale
      const vh = (quarter ? first.box.width : first.box.height) * plan.scale
      return { tw, th, vw, vh, scale: plan.scale, error: null as Message | null }
    } catch (e) {
      return { error: e instanceof UserFacingError ? e.toMessage() : ({ key: 'err.resizeMargin' } as Message) }
    }
  }, [first, options])

  const startOver = () => { job.reset(); sel.clear() }
  const invalid = !options || !!pages.error || !!preview?.error

  const run = () =>
    job.run(async ({ signal, progress }) => {
      if (!options) return []
      const out: OutputFile[] = []
      for (let i = 0; i < sel.files.length; i++) {
        const f = sel.files[i]
        progress(i / sel.files.length, { key: 'prog.resizing', params: { name: f.name } })
        const bytes = await runInWorker('resize', { file: { name: f.name, bytes: await readBytes(f) }, options }, { signal })
        const label = size === 'custom' ? 'custom' : size
        out.push({ name: deriveName(f.name, `-${label}`, 'pdf'), blob: pdfBlob(bytes) })
      }
      return out
    })

  const fmt = (pt: number) => (unit === 'mm' ? `${Math.round(pt / PT.mm)} mm` : `${(pt / 72).toFixed(2)} in`)

  return (
    <ToolFrame
      job={job}
      hasInput={sel.files.length > 0}
      rejections={sel.rejections}
      onDismissRejections={() => sel.setRejections([])}
      onStartOver={startOver}
      zipName="resized-pdfs.zip"
      dropzone={<Dropzone accept={ACCEPT} multiple onFiles={sel.add} />}
      workspace={
        <Workspace
          main={
            <div className="space-y-4">
              <FileList files={sel.files} onRemove={sel.remove} />
              <Dropzone accept={ACCEPT} multiple compact onFiles={sel.add} />
              {doc && preview && !preview.error && preview.tw && (
                <figure className="rounded-2xl border border-line bg-surface p-4" data-testid="resize-preview">
                  <figcaption className="mb-3 text-sm font-semibold">{t('rs.preview')}</figcaption>
                  <div className="flex justify-center">
                    <div
                      className="relative overflow-hidden border border-line-strong bg-paper shadow-sm"
                      style={{ width: 220, height: (220 * preview.th!) / preview.tw!, maxHeight: 320, aspectRatio: `${preview.tw} / ${preview.th}` }}
                    >
                      <div
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 outline outline-1 outline-accent/60"
                        style={{ width: `${(100 * preview.vw!) / preview.tw!}%`, height: `${(100 * preview.vh!) / preview.th!}%` }}
                      >
                        <div className="h-full w-full [&_canvas]:!h-full [&_canvas]:!w-full [&_img]:!h-full [&_img]:!w-full">
                          <PageThumb doc={doc} pageNumber={1} width={220} />
                        </div>
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 text-center text-sm text-muted" dir="auto">
                    {t('rs.previewNote', { size: `${fmt(preview.tw!)} × ${fmt(preview.th!)}`, scale: Math.round(preview.scale! * 100) })}
                  </p>
                </figure>
              )}
            </div>
          }
          side={
            <>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">{t('rs.size')}</span>
                <select value={size} onChange={(e) => setSize(e.target.value as Size)} className={fieldCls} data-testid="rs-size">
                  {SIZES.map((s) => <option key={s} value={s}>{t(`rs.size.${s}`)}</option>)}
                </select>
              </label>
              {size === 'custom' && (
                <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">{t('rs.width')}</span>
                    <input value={custom.w} onChange={(e) => setCustom({ ...custom, w: e.target.value })} inputMode="decimal" dir="ltr" className={fieldCls} data-testid="rs-w" /></label>
                  <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">{t('rs.height')}</span>
                    <input value={custom.h} onChange={(e) => setCustom({ ...custom, h: e.target.value })} inputMode="decimal" dir="ltr" className={fieldCls} data-testid="rs-h" /></label>
                  <select aria-label={t('rs.unit')} value={unit} onChange={(e) => setUnit(e.target.value as Unit)} className={`${fieldCls} w-auto`}>
                    <option value="mm">mm</option>
                    <option value="in">in</option>
                  </select>
                </div>
              )}
              {size === 'custom' && !target && <p className="text-sm font-semibold text-danger" role="alert">{t('rs.customInvalid')}</p>}
              <Segmented<Orientation>
                label={t('rs.orientation')}
                value={orientation}
                onChange={setOrientation}
                options={[
                  { value: 'auto', label: t('rs.or.auto') },
                  { value: 'portrait', label: t('rs.or.portrait') },
                  { value: 'landscape', label: t('rs.or.landscape') },
                ]}
              />
              <Segmented<ResizeMode>
                label={t('rs.mode')}
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'fit', label: t('rs.mode.fit'), hint: t('rs.mode.fitHint') },
                  { value: 'fitWidth', label: t('rs.mode.fitWidth'), hint: t('rs.mode.fitWidthHint') },
                  { value: 'canvas', label: t('rs.mode.canvas'), hint: t('rs.mode.canvasHint') },
                ]}
              />
              {mode !== 'canvas' && (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">{t('rs.margin')}</span>
                  <input value={margin} onChange={(e) => setMargin(e.target.value)} inputMode="decimal" dir="ltr" className={fieldCls} data-testid="rs-margin" />
                </label>
              )}
              {single && (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">{t('rs.pages')}</span>
                  <input value={pagesText} onChange={(e) => setPagesText(e.target.value)} placeholder={t('rs.pagesAll')} dir="ltr" inputMode="numeric" className={fieldCls} data-testid="ranges" />
                </label>
              )}
              {pages.error && <p className="text-sm font-semibold text-danger" role="alert">{tm(pages.error)}</p>}
              {preview?.error && <p className="text-sm font-semibold text-danger" role="alert">{tm(preview.error)}</p>}
              <p className="text-sm text-muted">{t('rs.keeps')}</p>
              <Button variant="primary" size="lg" icon="resize" className="w-full" disabled={invalid} onClick={run} data-testid="run">
                {t('rs.run', { count: sel.files.length })}
              </Button>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
