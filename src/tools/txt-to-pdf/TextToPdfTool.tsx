import { useId, useState } from 'react'
import { Dropzone } from '../../components/Dropzone'
import { FileList } from '../../components/FileList'
import { ToolFrame } from '../../components/ToolFrame'
import { Button, LocalBadge, Segmented, Workspace } from '../../components/ui'
import { readBytes, useFiles } from '../../components/useFiles'
import { useJob } from '../../components/useJob'
import { deriveName } from '../../lib/files'
import { pdfBlob, type OutputFile } from '../../lib/output'
import type { TextEncoding, TextToPdfOptions } from '../../lib/convert/textToPdf'
import type { FileKind } from '../../lib/validate'
import { runInWorker } from '../../lib/workerClient'
import { useI18n } from '../../i18n/context'

const ACCEPT: FileKind[] = ['text']
const SIZES = [9, 10, 11, 12, 14, 16]
const selectCls = 'h-11 w-full rounded-xl border border-line-strong bg-paper px-3 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15'

export default function TextToPdfTool() {
  const { t } = useI18n()
  const sel = useFiles(ACCEPT, { multiple: true })
  const job = useJob()
  const [pageSize, setPageSize] = useState<TextToPdfOptions['pageSize']>('a4')
  const [orientation, setOrientation] = useState<TextToPdfOptions['orientation']>('portrait')
  const [font, setFont] = useState<TextToPdfOptions['font']>('helvetica')
  const [size, setSize] = useState(11)
  const [margin, setMargin] = useState(54)
  const [encoding, setEncoding] = useState<TextEncoding>('auto')
  const sizeId = useId()
  const encId = useId()
  const startOver = () => { job.reset(); sel.clear() }

  const convert = () =>
    job.run(async ({ signal, progress }) => {
      const out: OutputFile[] = []
      const options: TextToPdfOptions = { pageSize, orientation, font, size, margin, encoding }
      for (let i = 0; i < sel.files.length; i++) {
        const f = sel.files[i]
        const r = await runInWorker('textToPdf', { file: { name: f.name, bytes: await readBytes(f) }, options }, {
          signal,
          onProgress: (v, label) => progress((i + v) / sel.files.length, label),
        })
        // One line under each file: pages and encoding, plus anything the user should check.
        const params = { count: r.pages, encoding: r.encoding, chars: r.missing.join(' ') }
        const key = r.missing.length ? 't2p.noteMissing' : r.guessed ? 't2p.noteGuessed' : r.fontSwitched && font !== 'helvetica' ? 't2p.noteFont' : 't2p.note'
        out.push({ name: deriveName(f.name, '', 'pdf'), blob: pdfBlob(r.pdf), note: { key, params } })
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
      zipName="text-to-pdf.zip"
      dropzone={<Dropzone accept={ACCEPT} multiple onFiles={sel.add} />}
      workspace={
        <Workspace
          main={
            <div className="space-y-3">
              <FileList files={sel.files} modifiesPdf={false} onRemove={sel.remove} />
              <Dropzone accept={ACCEPT} multiple compact onFiles={sel.add} />
            </div>
          }
          side={
            <>
              <Segmented<TextToPdfOptions['font']>
                label={t('t2p.font')}
                value={font}
                onChange={setFont}
                options={[
                  { value: 'helvetica', label: t('t2p.sans') },
                  { value: 'times', label: t('t2p.serif') },
                  { value: 'courier', label: t('t2p.mono'), hint: t('t2p.monoHint') },
                ]}
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={sizeId} className="mb-2 block font-semibold">{t('t2p.size')}</label>
                  <select id={sizeId} value={size} onChange={(e) => setSize(Number(e.target.value))} className={selectCls}>
                    {SIZES.map((s) => <option key={s} value={s}>{t('t2p.pt', { n: s })}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={encId} className="mb-2 block font-semibold">{t('t2p.encoding')}</label>
                  <select id={encId} value={encoding} onChange={(e) => setEncoding(e.target.value as TextEncoding)} className={selectCls}>
                    <option value="auto">{t('t2p.encAuto')}</option>
                    <option value="utf-8">UTF-8</option>
                    <option value="windows-1252">{t('t2p.enc1252')}</option>
                    <option value="windows-1256">{t('t2p.enc1256')}</option>
                  </select>
                </div>
              </div>
              <Segmented<TextToPdfOptions['pageSize']> label={t('i2p.pageSize')} value={pageSize} onChange={setPageSize} options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: t('i2p.letter') }]} />
              <Segmented<TextToPdfOptions['orientation']>
                label={t('i2p.orientation')}
                value={orientation}
                onChange={setOrientation}
                options={[{ value: 'portrait', label: t('i2p.portrait') }, { value: 'landscape', label: t('i2p.landscape') }]}
              />
              <Segmented<number>
                label={t('i2p.margin')}
                value={margin}
                onChange={setMargin}
                options={[{ value: 36, label: t('t2p.narrow') }, { value: 54, label: t('t2p.normal') }, { value: 72, label: t('t2p.wide') }]}
              />
              <Button variant="primary" size="lg" icon="textIn" className="w-full" onClick={convert} data-testid="run">
                {t('t2p.run', { count: sel.files.length })}
              </Button>
              <p className="text-sm text-muted">{t('t2p.help')}</p>
              <LocalBadge />
            </>
          }
        />
      }
    />
  )
}
