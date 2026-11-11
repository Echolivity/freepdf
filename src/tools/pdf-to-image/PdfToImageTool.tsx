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
import { canEncodeWebp, canvasToBlob, closePdf, openPdf, releaseCanvas, renderPage } from '../../lib/render/pdfjs'
import { UserFacingError, type FileKind } from '../../lib/validate'
import { CancelledError } from '../../lib/workerClient'
import { useI18n } from '../../i18n/context'

const ACCEPT: FileKind[] = ['pdf']
type Format = 'jpg' | 'png' | 'webp'
type Dpi = 72 | 150 | 300
const MIME: Record<Format, 'image/jpeg' | 'image/png' | 'image/webp'> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

export default function PdfToImageTool({ tool }: { tool: ToolDef }) {
  const { t } = useI18n()
  const sel = useFiles(ACCEPT, { multiple: true })
  const job = useJob()
  const [webp] = useState(canEncodeWebp)
  const [format, setFormat] = useState<Format>(tool.slug === 'pdf-to-png' ? 'png' : tool.slug === 'pdf-to-webp' && webp ? 'webp' : tool.slug === 'pdf-to-webp' ? 'png' : 'jpg')
  const [dpi, setDpi] = useState<Dpi>(150)
  const [quality, setQuality] = useState<0.92 | 0.8>(0.92)
  const [range, setRange] = useState('')
  const pw = usePdfPasswords(sel.files)
  const rangeError = batchRangeError(range)
  const startOver = () => { job.reset(); sel.clear(); pw.reset(); setRange('') }

  const convert = () =>
    job.run(async ({ signal, progress }) => {
      const out: OutputFile[] = []
      const mime = MIME[format]
      for (let fi = 0; fi < sel.files.length; fi++) {
        const f = sel.files[fi]
        const doc = await openPdf(await readBytes(f), { name: f.name, password: pw.passwordOf(f), forExport: true })
        try {
          const pad = String(doc.numPages).length
          const pages = batchPages(range, doc.numPages)
          if (!pages.length) throw new UserFacingError('err.rangeNoPages', { name: f.name, count: doc.numPages })
          for (let k = 0; k < pages.length; k++) {
            const p = pages[k] + 1
            if (signal.aborted) throw new CancelledError()
            const step = t('p2i.pageProgress', { page: k + 1, total: pages.length })
            progress(
              (fi + k / pages.length) / sel.files.length,
              sel.files.length > 1 ? { key: 'cmp.fileProgress', params: { name: f.name, step } } : { key: 'p2i.pageProgress', params: { page: k + 1, total: pages.length } },
            )
            const { canvas, scaleUsed } = await renderPage(doc, p, dpi / 72)
            try {
              const blob = await canvasToBlob(canvas, mime, format === 'png' ? undefined : quality)
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
              <FileList files={sel.files} modifiesPdf={false} onRemove={sel.remove} extra={pw.extra} />
              {pw.prompts}
              <Dropzone accept={ACCEPT} multiple compact onFiles={sel.add} />
            </div>
          }
          side={
            <>
              <Segmented<Format>
                label={t('p2i.format')}
                value={format}
                onChange={setFormat}
                options={[
                  { value: 'jpg', label: 'JPG', hint: t('p2i.jpgHint') },
                  { value: 'png', label: 'PNG', hint: t('p2i.pngHint') },
                  ...(webp ? [{ value: 'webp' as const, label: 'WebP', hint: t('p2i.webpHint') }] : []),
                ]}
              />
              {!webp && <Notice tone="info">{t('p2i.noWebp')}</Notice>}
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
              {format !== 'png' && (
                <Segmented<0.92 | 0.8> label={t('p2i.quality')} value={quality} onChange={setQuality} options={[{ value: 0.92, label: t('p2i.qHigh') }, { value: 0.8, label: t('p2i.qStd') }]} />
              )}
              <PageRangeField value={range} onChange={setRange} error={rangeError} />
              {pw.locked.length > 0 && <Notice tone="info">{t('p2i.unlockFirst', { count: pw.locked.length })}</Notice>}
              <Button variant="primary" size="lg" icon="imageOut" className="w-full" disabled={pw.locked.length > 0 || pw.checking || !!rangeError} onClick={convert} data-testid="run">
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
