import { useState } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { ToolFrame } from '../../components/ToolFrame'
import { Button, LocalBadge, Notice, Segmented, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useJob } from '../../components/useJob'
import { usePdfPasswords } from '../../components/PdfPasswords'
import { PageRangeField } from '../../components/PageRangeField'
import type { ToolDef } from '../registry'
import { deriveName } from '../../lib/files'
import type { OutputFile } from '../../lib/output'
import { batchPages, batchRangeError } from '../../lib/ranges'
import { canvasToBlob, closePdf, openPdf, pdfjsOps, releaseCanvas, renderPage, type PDFDocumentProxy } from '../../lib/render/pdfjs'
import type { Cropper } from '../../lib/convert/pdfToOffice'
import type { DocLike } from '../../lib/convert/pdfExport'
import { UserFacingError, type FileKind } from '../../lib/validate'
import { CancelledError } from '../../lib/workerClient'
import { useI18n } from '../../i18n/context'

const ACCEPT: FileKind[] = ['pdf']
type Target = 'docx' | 'xlsx' | 'pptx'
const TARGET: Record<string, Target> = { 'pdf-to-word': 'docx', 'pdf-to-excel': 'xlsx', 'pdf-to-powerpoint': 'pptx' }
const MIME: Record<Target, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

/** Crops (or whole pages) from PDF.js renders, re-using one render per page and scale. */
function cropper(doc: PDFDocumentProxy): { crop: Cropper; dispose: () => void } {
  let cached: { key: string; canvas: HTMLCanvasElement; scale: number } | null = null
  const crop: Cropper = async (n, rect, scale) => {
    const key = `${n}@${scale.toFixed(3)}`
    if (cached?.key !== key) {
      if (cached) releaseCanvas(cached.canvas)
      const r = await renderPage(doc, n, scale)
      cached = { key, canvas: r.canvas, scale: r.scaleUsed }
    }
    const { canvas, scale: s } = cached
    let source = canvas
    if (rect) {
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(rect.w * s))
      c.height = Math.max(1, Math.round(rect.h * s))
      c.getContext('2d')!.drawImage(canvas, Math.round(rect.x * s), Math.round(rect.y * s), c.width, c.height, 0, 0, c.width, c.height)
      source = c
    }
    const blob = await canvasToBlob(source, 'image/jpeg', 0.9)
    if (source !== canvas) releaseCanvas(source)
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'jpeg' }
  }
  return { crop, dispose: () => { if (cached) releaseCanvas(cached.canvas); cached = null } }
}

export default function PdfToOfficeTool({ tool }: { tool: ToolDef }) {
  const { t } = useI18n()
  const target = TARGET[tool.slug] ?? 'docx'
  const sel = useFiles(ACCEPT, { multiple: true })
  const job = useJob()
  const pw = usePdfPasswords(sel.files)
  const [range, setRange] = useState('')
  const [pageBreaks, setPageBreaks] = useState(true)
  const [images, setImages] = useState(true)
  const [perPage, setPerPage] = useState(true)
  const [numbers, setNumbers] = useState(true)
  const [dpi, setDpi] = useState<150 | 220>(150)
  const rangeError = batchRangeError(range)
  const startOver = () => { job.reset(); sel.clear(); pw.reset(); setRange('') }

  const convert = () =>
    job.run(async ({ signal, progress }) => {
      const office = await import('../../lib/convert/pdfToOffice')
      const out: OutputFile[] = []
      for (let fi = 0; fi < sel.files.length; fi++) {
        const f = sel.files[fi]
        const doc = await openPdf(await readBytes(f), { name: f.name, password: pw.passwordOf(f), forExport: true })
        const c = cropper(doc)
        try {
          const pages = batchPages(range, doc.numPages).map((i) => i + 1)
          if (!pages.length) throw new UserFacingError('err.rangeNoPages', { name: f.name, count: doc.numPages })
          const onProgress = (v: number) => progress((fi + v) / sel.files.length, sel.files.length > 1 ? { key: 'cmp.fileProgress', params: { name: f.name, step: t('p2o.working') } } : { key: 'p2o.working' })
          const title = f.name.replace(/\.pdf$/i, '')
          const d = doc as unknown as DocLike
          let bytes: Uint8Array
          let note: OutputFile['note']
          if (target === 'docx') {
            const r = await office.pdfToDocx(d, pages, { pageBreaks, images, title, OPS: pdfjsOps(), crop: c.crop, signal, onProgress })
            if (!r.text && !r.images) throw new UserFacingError('err.noTextLayer', { count: 1 })
            bytes = r.bytes
            note = { key: r.text ? 'p2o.noteWord' : 'p2o.noteWordScan', params: { count: pages.length, images: r.images } }
          } else if (target === 'xlsx') {
            const r = await office.pdfToXlsx(d, pages, { perPage, numbers, title, sheetLabel: (n) => t('p2t.pageMarker', { n }), signal, onProgress })
            if (!r.rows) throw new UserFacingError('err.noTextLayer', { count: 1 })
            bytes = r.bytes
            note = { key: 'p2o.noteExcel', params: { count: perPage ? pages.length : 1, rows: r.rows } }
          } else {
            bytes = await office.pdfToPptx(d, pages, { title, dpi, crop: c.crop, signal, onProgress })
            note = { key: 'p2o.notePpt', params: { count: pages.length } }
          }
          out.push({ name: deriveName(f.name, '', target), blob: new Blob([bytes as BlobPart], { type: MIME[target] }), note })
        } finally {
          c.dispose()
          await closePdf(doc)
        }
        if (signal.aborted) throw new CancelledError()
      }
      return out
    })

  const icon = target === 'docx' ? 'docOut' : target === 'xlsx' ? 'sheetOut' : 'slidesOut'
  return (
    <ToolFrame
      job={job}
      hasInput={sel.files.length > 0}
      rejections={sel.rejections}
      onDismissRejections={() => sel.setRejections([])}
      onStartOver={startOver}
      zipName={`${tool.slug}.zip`}
      dropzone={<Dropzone accept={ACCEPT} multiple onFiles={sel.add} />}
      workspace={
        <Workspace
          main={
            <div className="space-y-3">
              <FileList files={sel.files} modifiesPdf={false} onRemove={sel.remove} extra={pw.extra} />
              {pw.prompts}
              <Dropzone accept={ACCEPT} multiple compact onFiles={sel.add} />
            </div>
          }
          side={
            <>
              {target === 'docx' && (
                <>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 font-semibold">
                    <input type="checkbox" className="h-5 w-5" checked={images} onChange={(e) => setImages(e.target.checked)} />
                    {t('p2o.images')}
                  </label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 font-semibold">
                    <input type="checkbox" className="h-5 w-5" checked={pageBreaks} onChange={(e) => setPageBreaks(e.target.checked)} />
                    {t('p2o.pageBreaks')}
                  </label>
                </>
              )}
              {target === 'xlsx' && (
                <>
                  <Segmented<'page' | 'one'>
                    label={t('p2o.sheets')}
                    value={perPage ? 'page' : 'one'}
                    onChange={(v) => setPerPage(v === 'page')}
                    options={[{ value: 'page', label: t('p2o.sheetPerPage') }, { value: 'one', label: t('p2o.oneSheet') }]}
                  />
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 font-semibold">
                    <input type="checkbox" className="h-5 w-5" checked={numbers} onChange={(e) => setNumbers(e.target.checked)} />
                    {t('p2o.numbers')}
                  </label>
                </>
              )}
              {target === 'pptx' && (
                <Segmented<150 | 220>
                  label={t('p2i.resolution')}
                  value={dpi}
                  onChange={setDpi}
                  options={[{ value: 150, label: t('p2o.standard'), hint: t('p2i.dpi', { n: 150 }) }, { value: 220, label: t('p2o.high'), hint: t('p2i.dpi', { n: 220 }) }]}
                />
              )}
              <PageRangeField value={range} onChange={setRange} error={rangeError} />
              {pw.locked.length > 0 && <Notice tone="info">{t('p2i.unlockFirst', { count: pw.locked.length })}</Notice>}
              <Button variant="primary" size="lg" icon={icon} className="w-full" disabled={pw.locked.length > 0 || pw.checking || !!rangeError} onClick={convert} data-testid="run">
                {t(target === 'docx' ? 'p2o.runWord' : target === 'xlsx' ? 'p2o.runExcel' : 'p2o.runPpt')}
              </Button>
              <Notice tone="info">{t(target === 'docx' ? 'p2o.limitsWord' : target === 'xlsx' ? 'p2o.limitsExcel' : 'p2o.limitsPpt')}</Notice>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
