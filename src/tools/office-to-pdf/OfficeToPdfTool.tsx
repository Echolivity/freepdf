import { useState } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { ToolFrame } from '../../components/ToolFrame'
import { Button, LocalBadge, Notice, Segmented, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useJob } from '../../components/useJob'
import type { ToolDef } from '../registry'
import { deriveName } from '../../lib/files'
import { pdfBlob, type OutputFile } from '../../lib/output'
import type { FileKind } from '../../lib/validate'
import type { Orientation, PaperSize } from '../../lib/convert/officeToPdf'
import { CancelledError } from '../../lib/workerClient'
import { useI18n } from '../../i18n/context'

type Kind = 'docx' | 'xlsx' | 'html'
const KIND: Record<string, Kind> = { 'word-to-pdf': 'docx', 'excel-to-pdf': 'xlsx', 'html-to-pdf': 'html' }

/** Word, Excel and HTML → PDF, laid out by the browser in this tab (see lib/convert/domToPdf.ts). */
export default function OfficeToPdfTool({ tool }: { tool: ToolDef }) {
  const { t } = useI18n()
  const kind = KIND[tool.slug] ?? 'docx'
  const accept: FileKind[] = [kind]
  const sel = useFiles(accept, { multiple: true })
  const job = useJob()
  const [size, setSize] = useState<PaperSize>('a4')
  const [orientation, setOrientation] = useState<Orientation>('auto')
  const [margin, setMargin] = useState(kind === 'xlsx' ? 36 : 54)
  const [fit, setFit] = useState(true)
  // Excel doesn't print gridlines unless asked to.
  const [gridlines, setGridlines] = useState(false)
  const [sheetNames, setSheetNames] = useState(true)
  const [headersFooters, setHeadersFooters] = useState(true)
  const startOver = () => { job.reset(); sel.clear() }

  const convert = () =>
    job.run(async ({ signal, progress }) => {
      const conv = await import('../../lib/convert/officeToPdf')
      const out: OutputFile[] = []
      for (let i = 0; i < sel.files.length; i++) {
        const f = sel.files[i]
        if (signal.aborted) throw new CancelledError()
        const onProgress = (v: number) => progress((i + v) / sel.files.length, sel.files.length > 1 ? { key: 'cmp.fileProgress', params: { name: f.name, step: t('o2p.converting') } } : { key: 'o2p.converting' })
        onProgress(0)
        const bytes = await readBytes(f)
        const r =
          kind === 'docx'
            ? await conv.docxToPdf(bytes, f.name, { signal, onProgress, headersFooters })
            : kind === 'xlsx'
              ? await conv.xlsxToPdf(bytes, f.name, { signal, onProgress, size, orientation, margin, fit, gridlines, sheetNames })
              : await conv.htmlToPdf(new TextDecoder('utf-8').decode(bytes), f.name, { signal, onProgress, size, orientation, margin, fit })
        const key = r.removed ? 'o2p.noteRemoved' : r.skippedImages ? 'o2p.noteSkipped' : r.sheets ? 'o2p.noteSheets' : 'note.pages'
        out.push({ name: deriveName(f.name, '', 'pdf'), blob: pdfBlob(r.pdf), note: { key, params: { count: r.pages, removed: r.removed ?? 0, images: r.skippedImages, sheets: r.sheets ?? 0 } } })
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
      zipName={`${tool.slug}.zip`}
      dropzone={<Dropzone accept={accept} multiple onFiles={sel.add} />}
      workspace={
        <Workspace
          main={
            <div className="space-y-3">
              <FileList files={sel.files} modifiesPdf={false} onRemove={sel.remove} />
              <Dropzone accept={accept} multiple compact onFiles={sel.add} />
            </div>
          }
          side={
            <>
              {kind === 'docx' ? (
                <>
                  <p className="text-[15px]">{t('o2p.docxPages')}</p>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 font-semibold">
                    <input type="checkbox" className="h-5 w-5" checked={headersFooters} onChange={(e) => setHeadersFooters(e.target.checked)} />
                    {t('o2p.headersFooters')}
                  </label>
                </>
              ) : (
                <>
                  <Segmented<PaperSize> label={t('i2p.pageSize')} value={size} onChange={setSize} options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: t('i2p.letter') }]} />
                  <Segmented<Orientation>
                    label={t('i2p.orientation')}
                    value={orientation}
                    onChange={setOrientation}
                    options={[
                      { value: 'auto', label: t('i2p.auto'), hint: t('o2p.autoHint') },
                      { value: 'portrait', label: t('i2p.portrait') },
                      { value: 'landscape', label: t('i2p.landscape') },
                    ]}
                  />
                  <Segmented<number>
                    label={t('i2p.margin')}
                    value={margin}
                    onChange={setMargin}
                    options={[{ value: 36, label: t('t2p.narrow') }, { value: 54, label: t('t2p.normal') }, { value: 72, label: t('t2p.wide') }]}
                  />
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 font-semibold">
                    <input type="checkbox" className="h-5 w-5" checked={fit} onChange={(e) => setFit(e.target.checked)} />
                    {t(kind === 'xlsx' ? 'o2p.fitSheet' : 'o2p.fitPage')}
                  </label>
                  {kind === 'xlsx' && (
                    <>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 font-semibold">
                        <input type="checkbox" className="h-5 w-5" checked={gridlines} onChange={(e) => setGridlines(e.target.checked)} />
                        {t('o2p.gridlines')}
                      </label>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 font-semibold">
                        <input type="checkbox" className="h-5 w-5" checked={sheetNames} onChange={(e) => setSheetNames(e.target.checked)} />
                        {t('o2p.sheetNames')}
                      </label>
                    </>
                  )}
                </>
              )}
              <Button variant="primary" size="lg" icon="docIn" className="w-full" onClick={convert} data-testid="run">
                {t('o2p.run', { count: sel.files.length })}
              </Button>
              <Notice tone="info">{t(kind === 'docx' ? 'o2p.limitsDocx' : kind === 'xlsx' ? 'o2p.limitsXlsx' : 'o2p.limitsHtml')}</Notice>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
