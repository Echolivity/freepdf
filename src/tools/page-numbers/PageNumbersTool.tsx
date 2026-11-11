import { useMemo, useState } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { LivePreview } from '../../components/LivePreview'
import { ToolFrame } from '../../components/ToolFrame'
import { Button, LocalBadge, Notice, Segmented, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useJob } from '../../components/useJob'
import { usePdfDoc } from '../../components/usePdfDoc'
import { deriveName } from '../../lib/files'
import { pdfBlob } from '../../lib/output'
import type { FontFamily } from '../../lib/pdf/fonts'
import { pageLabels, type NumberStyle } from '../../lib/pdf/labels'
import type { PageNumberOptions } from '../../lib/pdf/stamp'
import { parsePageSet } from '../../lib/ranges'
import { UserFacingError, type FileKind } from '../../lib/validate'
import { runInWorker } from '../../lib/workerClient'
import { useI18n } from '../../i18n/context'
import type { Message } from '../../i18n/core'
import { FontPicker, field } from '../stamp-ui'

const ACCEPT: FileKind[] = ['pdf']
const MM = 72 / 25.4

export default function PageNumbersTool() {
  const { t, tm } = useI18n()
  const sel = useFiles(ACCEPT, { multiple: false })
  const file = sel.files[0] ?? null
  const { doc, error: docError, loading } = usePdfDoc(file)
  const job = useJob()
  const count = doc?.numPages ?? 0
  const [vertical, setVertical] = useState<'top' | 'bottom'>('bottom')
  const [align, setAlign] = useState<'left' | 'center' | 'right'>('center')
  const [margin, setMargin] = useState('12')
  const [start, setStart] = useState('1')
  const [style, setStyle] = useState<NumberStyle>('decimal')
  const [prefix, setPrefix] = useState('')
  const [suffix, setSuffix] = useState('')
  const [font, setFont] = useState<FontFamily>('helvetica')
  const [bold, setBold] = useState(false)
  const [size, setSize] = useState('11')
  const [color, setColor] = useState('#000000')
  const [pagesText, setPagesText] = useState('')
  const [skipFirst, setSkipFirst] = useState(false)
  const [page, setPage] = useState(0)

  const [pageFor, setPageFor] = useState(file)
  if (pageFor !== file) { setPageFor(file); setPage(0) }

  const pages = useMemo((): { indices: number[] | null; error: Message | null } => {
    if (!pagesText.trim()) return { indices: null, error: null }
    try {
      return { indices: parsePageSet(pagesText, count), error: null }
    } catch (e) {
      return { indices: null, error: e instanceof UserFacingError ? e.toMessage() : { key: 'rng.empty' } }
    }
  }, [pagesText, count])

  const startN = Number(start)
  const sizeN = Number(size.replace(',', '.'))
  const optsError: Message | null =
    !Number.isInteger(startN) || startN < 0 || startN > 1_000_000 ? { key: 'err.stampStart' } : !(sizeN >= 4 && sizeN <= 200) ? { key: 'err.stampSize' } : null
  const options: PageNumberOptions = {
    vertical, align, margin: Math.max(0, Number(margin.replace(',', '.')) || 0) * MM, start: startN, style, prefix, suffix,
    font, bold, size: sizeN, color, indices: pages.indices, skipFirst,
  }
  const labels = useMemo(() => (count ? pageLabels(count, options) : []), [count, options.indices, options.skipFirst, options.start, options.style, options.prefix, options.suffix]) // eslint-disable-line react-hooks/exhaustive-deps
  const numbered = labels.filter(Boolean).length
  const invalid = !doc || !!pages.error || !!optsError || !numbered

  const run = () =>
    job.run(async ({ signal, progress }) => {
      if (!file) return []
      const out = await runInWorker('pageNumbers', { file: { name: file.name, bytes: await readBytes(file) }, options }, { signal, onProgress: progress })
      return [{ name: deriveName(file.name, '-numbered', 'pdf'), blob: pdfBlob(out), note: { key: 'note.numbered', params: { count: numbered } } }]
    })
  const startOver = () => { job.reset(); sel.clear() }

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
                <>
                  <LivePreview
                    file={file}
                    count={count}
                    page={page}
                    onPage={setPage}
                    settingsKey={JSON.stringify(options) + (labels[page] ?? '')}
                    make={(sample, p) => {
                      if (!labels[p] || optsError) return null
                      // Same drawing code as the download, with this page's own number.
                      const number = startN + labels.slice(0, p).filter(Boolean).length
                      return runInWorker('pageNumbers', { file: sample, options: { ...options, indices: [0], skipFirst: false, start: number } })
                    }}
                  />
                  <p className="text-center text-sm text-muted" data-testid="label-preview" dir="auto">
                    {labels[page] ? t('pn.thisPage', { label: labels[page]! }) : t('pn.notNumbered')}
                  </p>
                </>
              )}
            </div>
          }
          side={
            <>
              <Segmented<'top' | 'bottom'> label={t('pn.position')} value={vertical} onChange={setVertical} options={[{ value: 'top', label: t('pn.header') }, { value: 'bottom', label: t('pn.footer') }]} />
              <Segmented<'left' | 'center' | 'right'> label={t('pn.align')} value={align} onChange={setAlign} options={[{ value: 'left', label: t('pn.left') }, { value: 'center', label: t('pn.center') }, { value: 'right', label: t('pn.right') }]} />
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">{t('pn.start')}</span>
                  <input value={start} onChange={(e) => setStart(e.target.value.trim())} inputMode="numeric" dir="ltr" className={field} data-testid="pn-start" /></label>
                <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">{t('pn.style')}</span>
                  <select value={style} onChange={(e) => setStyle(e.target.value as NumberStyle)} className={field} data-testid="pn-style">
                    <option value="decimal">1, 2, 3</option>
                    <option value="roman">I, II, III</option>
                    <option value="roman-lower">i, ii, iii</option>
                    <option value="arabic-indic">١، ٢، ٣</option>
                  </select></label>
                <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">{t('pn.prefix')}</span>
                  <input value={prefix} onChange={(e) => setPrefix(e.target.value)} dir="auto" placeholder={t('pn.prefixHint')} className={field} data-testid="pn-prefix" /></label>
                <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">{t('pn.suffix')}</span>
                  <input value={suffix} onChange={(e) => setSuffix(e.target.value)} dir="auto" placeholder={t('pn.suffixHint')} className={field} data-testid="pn-suffix" /></label>
              </div>
              <FontPicker font={font} onFont={setFont} bold={bold} onBold={setBold} size={size} onSize={setSize} color={color} onColor={setColor} />
              <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">{t('pn.margin')}</span>
                <input value={margin} onChange={(e) => setMargin(e.target.value)} inputMode="decimal" dir="ltr" className={field} /></label>
              <label className="block"><span className="mb-1 block text-sm font-semibold">{t('pn.pages')}</span>
                <input value={pagesText} onChange={(e) => setPagesText(e.target.value)} placeholder={t('rs.pagesAll')} dir="ltr" inputMode="numeric" className={field} data-testid="ranges" /></label>
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={skipFirst} onChange={(e) => setSkipFirst(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" data-testid="pn-skip" />
                {t('pn.skipCover')}
              </label>
              {pages.error && <p className="text-sm font-semibold text-danger" role="alert">{tm(pages.error)}</p>}
              {optsError && <p className="text-sm font-semibold text-danger" role="alert">{tm(optsError)}</p>}
              {doc && !pages.error && !numbered && <p className="text-sm font-semibold text-danger" role="alert">{t('err.stampNoPages')}</p>}
              {doc && numbered > 0 && <p className="text-sm text-muted" data-testid="pn-summary">{t('pn.summary', { count: numbered })}</p>}
              <Button variant="primary" size="lg" icon="hash" className="w-full" disabled={invalid} onClick={run} data-testid="run">{t('pn.run')}</Button>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
