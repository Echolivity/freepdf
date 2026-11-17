import { useId, useState } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { ToolFrame } from '../../components/ToolFrame'
import { Button, LocalBadge, Notice, Segmented, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useJob } from '../../components/useJob'
import { usePdfPasswords } from '../../components/PdfPasswords'
import type { ToolDef } from '../registry'
import { deriveName } from '../../lib/files'
import type { OutputFile } from '../../lib/output'
import { closePdf, openPdf } from '../../lib/render/pdfjs'
import type { DocLike, PageText } from '../../lib/convert/pdfExport'
import type { StatementLabels } from '../../lib/convert/statementExport'
import { UserFacingError, type FileKind } from '../../lib/validate'
import { CancelledError } from '../../lib/workerClient'
import { useI18n } from '../../i18n/context'

const ACCEPT: FileKind[] = ['pdf']
type Format = 'xlsx' | 'csv' | 'ofx'
const MIME: Record<Format, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv;charset=utf-8',
  ofx: 'application/x-ofx',
}
const CURRENCIES = ['SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'EGP', 'JOD', 'USD', 'EUR', 'GBP']
const fieldCls = 'h-11 w-full rounded-xl border border-line-strong bg-paper px-3 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15'

/**
 * Bank statement → Excel / CSV / OFX. Reads the transaction table from a text PDF in the browser,
 * checks every row against the running balance, and writes the transactions oldest first.
 */
export default function BankStatementTool({ tool }: { tool: ToolDef }) {
  const { t } = useI18n()
  const sel = useFiles(ACCEPT, { multiple: true })
  const job = useJob()
  const pw = usePdfPasswords(sel.files)
  const [format, setFormat] = useState<Format>('xlsx')
  const [dates, setDates] = useState<'auto' | 'dmy' | 'mdy'>('auto')
  const [currency, setCurrency] = useState('auto')
  const currencyId = useId()
  const startOver = () => { job.reset(); sel.clear(); pw.reset() }

  const labels = (): StatementLabels => ({
    sheet: t('bst.sheet'), summary: t('bst.summary'), date: t('bst.col.date'), valueDate: t('bst.col.valueDate'), description: t('bst.col.description'),
    reference: t('bst.col.reference'), debit: t('bst.col.debit'), credit: t('bst.col.credit'), balance: t('bst.col.balance'), check: t('bst.col.check'),
    ok: t('bst.ok'), expected: t('bst.expected'), file: t('bst.sum.file'), account: t('bst.sum.account'), currency: t('bst.sum.currency'), period: t('bst.sum.period'),
    opening: t('bst.sum.opening'), closing: t('bst.sum.closing'), totalDebit: t('bst.sum.totalDebit'), totalCredit: t('bst.sum.totalCredit'),
    count: t('bst.sum.count'), checked: t('bst.sum.checked'), mismatches: t('bst.sum.mismatches'),
  })

  const convert = () =>
    job.run(async ({ signal, progress }) => {
      const [{ parseStatement }, ex, { readPageText }] = await Promise.all([import('../../lib/convert/statement'), import('../../lib/convert/statementExport'), import('../../lib/convert/pdfExport')])
      const out: OutputFile[] = []
      for (let fi = 0; fi < sel.files.length; fi++) {
        const f = sel.files[fi]
        const doc = await openPdf(await readBytes(f), { name: f.name, password: pw.passwordOf(f), forExport: true })
        try {
          const pages: PageText[] = []
          for (let n = 1; n <= doc.numPages; n++) {
            if (signal.aborted) throw new CancelledError()
            pages.push(await readPageText(doc as unknown as DocLike, n))
            progress((fi + (n / doc.numPages) * 0.9) / sel.files.length, sel.files.length > 1 ? { key: 'cmp.fileProgress', params: { name: f.name, step: t('bst.working') } } : { key: 'bst.working' })
          }
          if (!pages.some((p) => p.spans.length)) throw new UserFacingError('err.noTextLayer', { count: 1 })
          const s = parseStatement(pages, dates === 'auto' ? {} : { dateOrder: dates })
          if (!s) throw new UserFacingError('bst.noTable', { name: f.name })
          let bytes: Uint8Array
          if (format === 'xlsx') bytes = await ex.statementXlsx(s, labels(), { title: f.name.replace(/\.pdf$/i, ''), fileName: f.name })
          else if (format === 'csv') bytes = ex.statementCsv(s, labels())
          else {
            const cur = currency === 'auto' ? s.currency : currency
            if (!cur) throw new UserFacingError('bst.noCurrency', { name: f.name })
            bytes = ex.statementOfx(s, { currency: cur })
          }
          const n = s.transactions.length
          const note: OutputFile['note'] = s.mismatches
            ? { key: 'bst.noteMismatch', params: { count: n, mismatches: s.mismatches } }
            : s.checked
              ? { key: 'bst.noteOk', params: { count: n, checked: s.checked } }
              : { key: 'bst.noteUnchecked', params: { count: n } }
          out.push({ name: deriveName(f.name, '', format), blob: new Blob([bytes as BlobPart], { type: MIME[format] }), note })
        } finally {
          await closePdf(doc)
        }
        if (signal.aborted) throw new CancelledError()
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
                label={t('bst.format')}
                value={format}
                onChange={setFormat}
                options={[
                  { value: 'xlsx', label: 'Excel', hint: t('bst.formatExcel') },
                  { value: 'csv', label: 'CSV', hint: t('bst.formatCsv') },
                  { value: 'ofx', label: 'OFX', hint: t('bst.formatOfx') },
                ]}
              />
              {format === 'ofx' && (
                <div>
                  <label htmlFor={currencyId} className="mb-2 block font-semibold">{t('bst.currency')}</label>
                  <select id={currencyId} value={currency} onChange={(e) => setCurrency(e.target.value)} className={fieldCls} data-testid="bst-currency">
                    <option value="auto">{t('bst.currencyAuto')}</option>
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )}
              <Segmented<'auto' | 'dmy' | 'mdy'>
                label={t('bst.dates')}
                value={dates}
                onChange={setDates}
                options={[
                  { value: 'auto', label: t('bst.datesAuto') },
                  { value: 'dmy', label: t('bst.datesDmy'), hint: '31/12' },
                  { value: 'mdy', label: t('bst.datesMdy'), hint: '12/31' },
                ]}
              />
              {pw.locked.length > 0 && <Notice tone="info">{t('p2i.unlockFirst', { count: pw.locked.length })}</Notice>}
              <Button variant="primary" size="lg" icon="statement" className="w-full" disabled={pw.locked.length > 0 || pw.checking} onClick={convert} data-testid="run">
                {t('bst.run')}
              </Button>
              <Notice tone="info">{t('bst.limits')}</Notice>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
