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
import { closePdf, openPdf, releaseCanvas, renderPage, canvasToBlob, type PDFDocumentProxy } from '../../lib/render/pdfjs'
import { hasText, readPageText, toFlowHtml, toLayoutHtml, toPlainText, type PageText, type TextExportOptions } from '../../lib/convert/pdfExport'
import { UserFacingError, type FileKind } from '../../lib/validate'
import { CancelledError } from '../../lib/workerClient'
import { useI18n } from '../../i18n/context'

const ACCEPT: FileKind[] = ['pdf']
type HtmlMode = 'flow' | 'layout'
type Dpi = 96 | 150

/** PDF → TXT and PDF → HTML: both read the PDF's text layer with PDF.js, in this tab. */
export default function PdfToTextTool({ tool }: { tool: ToolDef }) {
  const { t } = useI18n()
  const html = tool.slug === 'pdf-to-html'
  const sel = useFiles(ACCEPT, { multiple: true })
  const job = useJob()
  const pw = usePdfPasswords(sel.files)
  const [range, setRange] = useState('')
  const [layout, setLayout] = useState<TextExportOptions['layout']>('lines')
  const [markers, setMarkers] = useState(true)
  const [eol, setEol] = useState<TextExportOptions['lineEnding']>('lf')
  const [mode, setMode] = useState<HtmlMode>('flow')
  const [dpi, setDpi] = useState<Dpi>(150)
  const rangeError = batchRangeError(range)
  const startOver = () => { job.reset(); sel.clear(); pw.reset(); setRange('') }

  const labels = { document: t('p2t.htmlDocument'), page: (n: number) => t('p2t.pageMarker', { n }) }

  const convert = () =>
    job.run(async ({ signal, progress }) => {
      const out: OutputFile[] = []
      let empty = 0
      for (let fi = 0; fi < sel.files.length; fi++) {
        const f = sel.files[fi]
        const doc = await openPdf(await readBytes(f), { name: f.name, password: pw.passwordOf(f), forExport: true })
        try {
          const pages = batchPages(range, doc.numPages)
          if (!pages.length) throw new UserFacingError('err.rangeNoPages', { name: f.name, count: doc.numPages })
          const read: (PageText & { image?: string })[] = []
          for (let k = 0; k < pages.length; k++) {
            if (signal.aborted) throw new CancelledError()
            const step = t('p2i.pageProgress', { page: k + 1, total: pages.length })
            progress((fi + k / pages.length) / sel.files.length, sel.files.length > 1 ? { key: 'cmp.fileProgress', params: { name: f.name, step } } : { key: 'p2i.pageProgress', params: { page: k + 1, total: pages.length } })
            const page: PageText & { image?: string } = await readPageText(doc, pages[k] + 1)
            if (html && mode === 'layout') page.image = await pageImage(doc, pages[k] + 1, dpi)
            read.push(page)
          }
          const found = hasText(read)
          if (!found) empty++
          const title = await docTitle(doc, f.name)
          if (html) {
            const body = mode === 'layout' ? toLayoutHtml(title, read as (PageText & { image: string })[], labels) : toFlowHtml(title, read, labels)
            out.push({
              name: deriveName(f.name, '', 'html'),
              blob: new Blob([body], { type: 'text/html;charset=utf-8' }),
              note: { key: found ? 'p2t.noteHtml' : 'p2t.noteNoText', params: { count: read.length } },
            })
          } else {
            const text = toPlainText(read, { layout, pageMarkers: markers, lineEnding: eol }, labels.page)
            out.push({
              name: deriveName(f.name, '', 'txt'),
              blob: new Blob([text], { type: 'text/plain;charset=utf-8' }),
              note: { key: found ? 'p2t.noteText' : 'p2t.noteNoText', params: { count: read.length, chars: [...text.replace(/\s/g, '')].length } },
            })
          }
        } finally {
          await closePdf(doc)
        }
      }
      // A scan has no text layer: say so plainly instead of handing over empty files — unless the
      // exact-layout HTML still carries the page images.
      if (empty === sel.files.length && !(html && mode === 'layout')) throw new UserFacingError('err.noTextLayer', { count: empty })
      return out
    })

  return (
    <ToolFrame
      job={job}
      hasInput={sel.files.length > 0}
      rejections={sel.rejections}
      onDismissRejections={() => sel.setRejections([])}
      onStartOver={startOver}
      zipName={sel.files[0] ? deriveName(sel.files[0].name, html ? '-html' : '-text', 'zip') : undefined}
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
              {html ? (
                <>
                  <Segmented<HtmlMode>
                    label={t('p2t.htmlMode')}
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: 'flow', label: t('p2t.flow'), hint: t('p2t.flowHint') },
                      { value: 'layout', label: t('p2t.layout'), hint: t('p2t.layoutHint') },
                    ]}
                  />
                  {mode === 'layout' && (
                    <Segmented<Dpi>
                      label={t('p2i.resolution')}
                      value={dpi}
                      onChange={setDpi}
                      options={[{ value: 96, label: t('p2t.screen'), hint: t('p2i.dpi', { n: 96 }) }, { value: 150, label: t('p2t.sharp'), hint: t('p2i.dpi', { n: 150 }) }]}
                    />
                  )}
                </>
              ) : (
                <>
                  <Segmented<TextExportOptions['layout']>
                    label={t('p2t.textLayout')}
                    value={layout}
                    onChange={setLayout}
                    options={[
                      { value: 'lines', label: t('p2t.lines'), hint: t('p2t.linesHint') },
                      { value: 'paragraphs', label: t('p2t.paragraphs'), hint: t('p2t.paragraphsHint') },
                    ]}
                  />
                  <Segmented<TextExportOptions['lineEnding']>
                    label={t('p2t.lineEnding')}
                    value={eol}
                    onChange={setEol}
                    options={[{ value: 'lf', label: t('p2t.lf') }, { value: 'crlf', label: t('p2t.crlf') }]}
                  />
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 font-semibold">
                    <input type="checkbox" className="h-5 w-5" checked={markers} onChange={(e) => setMarkers(e.target.checked)} />
                    {t('p2t.markers')}
                  </label>
                </>
              )}
              <PageRangeField value={range} onChange={setRange} error={rangeError} />
              {pw.locked.length > 0 && <Notice tone="info">{t('p2i.unlockFirst', { count: pw.locked.length })}</Notice>}
              <Button variant="primary" size="lg" icon={html ? 'htmlOut' : 'textOut'} className="w-full" disabled={pw.locked.length > 0 || pw.checking || !!rangeError} onClick={convert} data-testid="run">
                {t(html ? 'p2t.runHtml' : 'p2t.runText')}
              </Button>
              <p className="text-sm text-muted">{t(html ? 'p2t.htmlNote' : 'p2t.textNote')}</p>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}

/** The page rendered as a JPEG data URL, for the exact-layout HTML background. */
async function pageImage(doc: PDFDocumentProxy, n: number, dpi: number): Promise<string> {
  const { canvas } = await renderPage(doc, n, dpi / 72)
  try {
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.85)
    return await new Promise<string>((resolve, reject) => {
      // FileReader, not fetch(blob:), which the CSP's connect-src would block.
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.onerror = () => reject(r.error)
      r.readAsDataURL(blob)
    })
  } finally {
    releaseCanvas(canvas)
  }
}

async function docTitle(doc: PDFDocumentProxy, name: string): Promise<string> {
  try {
    const meta = await doc.getMetadata()
    const title = (meta.info as { Title?: unknown } | undefined)?.Title
    if (typeof title === 'string' && title.trim()) return title.trim()
  } catch {
    // Metadata is optional.
  }
  return name.replace(/\.pdf$/i, '')
}
