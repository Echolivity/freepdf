import { useState } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { PageRangeField } from '../../components/PageRangeField'
import { ToolFrame } from '../../components/ToolFrame'
import { Button, LocalBadge, Notice, Segmented, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useJob } from '../../components/useJob'
import { usePdfPasswords } from '../../components/PdfPasswords'
import type { ToolDef } from '../registry'
import { deriveName } from '../../lib/files'
import type { OutputFile } from '../../lib/output'
import { batchPages, batchRangeError } from '../../lib/ranges'
import { closePdf, openPdf } from '../../lib/render/pdfjs'
import { UserFacingError, type FileKind } from '../../lib/validate'
import { CancelledError, runInWorker } from '../../lib/workerClient'
import type { Ocr, OcrLang } from '../../lib/ocr/engine'
import { useI18n } from '../../i18n/context'

const ACCEPT: FileKind[] = ['pdf', 'jpeg', 'png', 'webp', 'tiff']
type Langs = 'eng' | 'ara' | 'both'
const LANGS: Record<Langs, OcrLang[]> = { eng: ['eng'], ara: ['ara'], both: ['ara', 'eng'] }

/**
 * OCR: scanned PDFs and photos of pages → searchable PDF (an invisible text layer over the unchanged
 * page images) or plain text. Recognition runs in the browser (tesseract.js, self-hosted).
 */
export default function OcrTool({ tool }: { tool: ToolDef }) {
  const { t, lang } = useI18n()
  const sel = useFiles(ACCEPT, { multiple: true })
  const job = useJob()
  const pw = usePdfPasswords(sel.files)
  const [langs, setLangs] = useState<Langs>(lang === 'ar' ? 'both' : 'eng')
  const [output, setOutput] = useState<'pdf' | 'txt'>('pdf')
  const [skip, setSkip] = useState(true)
  const [range, setRange] = useState('')
  const rangeError = batchRangeError(range)
  const startOver = () => { job.reset(); sel.clear(); pw.reset() }

  const run = () =>
    job.run(async ({ signal, progress }) => {
      const [{ createOcr }, { ocrPages }, { toPlainText }] = await Promise.all([import('../../lib/ocr/engine'), import('../../lib/ocr/run'), import('../../lib/convert/pdfExport')])
      const files = sel.files
      progress(0, { key: 'ocr.loading' })
      let ocr: Ocr | null = null
      const stop = () => { void ocr?.terminate() }
      signal.addEventListener('abort', stop)
      try {
        ocr = await createOcr(LANGS[langs], (stage, p) => {
          if (stage !== 'recognising') progress(0.02 + p * 0.03, { key: stage === 'engine' ? 'ocr.loading' : 'ocr.loadingLanguage' })
        })
        if (signal.aborted) throw new CancelledError()
        const out: OutputFile[] = []
        for (let fi = 0; fi < files.length; fi++) {
          const f = files[fi]
          let bytes = await readBytes(f)
          // A photo or scan image becomes a one-page PDF first (its own size), then gets the same treatment.
          if (f.kind !== 'pdf') {
            bytes = await runInWorker('imagesToPdf', { images: [{ name: f.name, kind: f.kind as 'jpeg' | 'png' | 'webp' | 'tiff', bytes }], options: { pageSize: 'fit', orientation: 'auto', margin: 0 } }, { signal })
          }
          const doc = await openPdf(bytes.slice(), { name: f.name, password: f.kind === 'pdf' ? pw.passwordOf(f) : undefined, forExport: true })
          let pages
          try {
            const numbers = (f.kind === 'pdf' ? batchPages(range, doc.numPages) : [0]).map((i) => i + 1)
            if (!numbers.length) throw new UserFacingError('err.rangeNoPages', { name: f.name, count: doc.numPages })
            pages = await ocrPages(doc, numbers, ocr, {
              skipWithText: skip,
              signal,
              onPage: (done, total, n) => {
                const frac = 0.05 + ((fi + done / total) / files.length) * 0.9
                progress(frac, files.length > 1 ? { key: 'cmp.fileProgress', params: { name: f.name, step: t('ocr.page', { n, count: doc.numPages }) } } : { key: 'ocr.page', params: { n, count: doc.numPages } })
              },
            })
          } finally {
            await closePdf(doc)
          }
          const recognised = pages.filter((p) => !p.skipped)
          const words = recognised.reduce((s, p) => s + p.layer.length, 0)
          const conf = recognised.length ? Math.round(recognised.reduce((s, p) => s + (p.confidence ?? 0), 0) / recognised.length) : 0
          const skipped = pages.length - recognised.length
          let blob: Blob
          let name: string
          if (output === 'pdf') {
            if (!recognised.length) throw new UserFacingError('ocr.allHaveText', { name: f.name })
            const pdf = await runInWorker('textLayer', { file: { name: f.name, bytes }, pages: recognised.map((p) => ({ index: p.number - 1, words: p.layer })) }, { signal })
            blob = new Blob([pdf as BlobPart], { type: 'application/pdf' })
            name = deriveName(f.name, '-ocr', 'pdf')
          } else {
            const text = toPlainText(pages.map((p) => p.text), { layout: 'paragraphs', pageMarkers: pages.length > 1, lineEnding: 'lf' }, (n) => t('p2t.pageMarker', { n }))
            blob = new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' })
            name = deriveName(f.name, '', 'txt')
          }
          const note: OutputFile['note'] = !recognised.length
            ? { key: 'ocr.noteAllText', params: { count: pages.length } }
            : !words
              ? { key: 'ocr.noteNone', params: { count: recognised.length } }
              : skipped
                ? { key: 'ocr.noteSkipped', params: { count: recognised.length, confidence: conf, skipped } }
                : { key: conf < 60 ? 'ocr.noteLow' : 'ocr.note', params: { count: recognised.length, confidence: conf } }
          out.push({ name, blob, note })
        }
        return out
      } finally {
        signal.removeEventListener('abort', stop)
        await ocr?.terminate().catch(() => {})
      }
    })

  const hasPdf = sel.files.some((f) => f.kind === 'pdf')
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
              <Segmented<Langs>
                label={t('ocr.language')}
                value={langs}
                onChange={setLangs}
                options={[
                  { value: 'eng', label: t('ocr.langEn') },
                  { value: 'ara', label: t('ocr.langAr') },
                  { value: 'both', label: t('ocr.langBoth'), hint: t('ocr.langBothHint') },
                ]}
              />
              <Segmented<'pdf' | 'txt'>
                label={t('ocr.output')}
                value={output}
                onChange={setOutput}
                options={[
                  { value: 'pdf', label: t('ocr.outPdf'), hint: t('ocr.outPdfHint') },
                  { value: 'txt', label: t('ocr.outTxt'), hint: t('ocr.outTxtHint') },
                ]}
              />
              {hasPdf && <PageRangeField value={range} onChange={setRange} error={rangeError} />}
              {hasPdf && (
                <label className="flex min-h-11 cursor-pointer items-center gap-3 font-semibold">
                  <input type="checkbox" className="h-5 w-5" checked={skip} onChange={(e) => setSkip(e.target.checked)} data-testid="ocr-skip" />
                  {t('ocr.skip')}
                </label>
              )}
              {pw.locked.length > 0 && <Notice tone="info">{t('p2i.unlockFirst', { count: pw.locked.length })}</Notice>}
              <Button variant="primary" size="lg" icon="ocr" className="w-full" disabled={pw.locked.length > 0 || pw.checking || !!rangeError} onClick={run} data-testid="run">
                {t('ocr.run')}
              </Button>
              <Notice tone="info">{t('ocr.limits')}</Notice>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
