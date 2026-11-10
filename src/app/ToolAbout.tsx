import { Link } from 'react-router-dom'
import { Icon, type IconName } from '../components/Icon'
import { LIMITS, MB } from '../config'
import { useI18n } from '../i18n/react'
import type { MessageKey } from '../i18n/core'
import type { ToolDef } from '../tools/registry'

/** Static information under each tool: formats, limits, privacy and a short FAQ. */
export function ToolAbout({ tool }: { tool: ToolDef }) {
  const { t } = useI18n()
  const limits = { file: LIMITS.maxFileBytes / MB, job: LIMITS.maxJobBytes / MB }
  const facts: { icon: IconName; label: MessageKey; text: string }[] = [
    { icon: 'file', label: 'about.input', text: t(`about.input.${tool.input}`) },
    { icon: 'download', label: 'about.output', text: t(`about.output.${tool.output}`) },
    { icon: 'cpu', label: 'about.limits', text: t('about.limitsText', limits) },
    { icon: 'shield', label: 'about.privacy', text: t('about.privacyText') },
  ]
  const faq: [MessageKey, MessageKey, Record<string, number>?][] = [
    [`faq.tool.${tool.slug}.q` as MessageKey, `faq.tool.${tool.slug}.a` as MessageKey],
    ['faq.free.q', 'faq.free.a'],
    ['faq.upload.q', 'faq.upload.a'],
    ['faq.limits.q', 'faq.limits.a', limits],
    ['faq.devices.q', 'faq.devices.a'],
  ]
  return (
    <div className="mt-16 grid gap-10 border-t border-line pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <section aria-labelledby="about-h">
        <h2 id="about-h" className="text-2xl font-semibold">{t('about.title')}</h2>
        <dl className="mt-5 space-y-4">
          {facts.map((f) => (
            <div key={f.label} className="flex gap-3">
              <dt className="flex w-28 shrink-0 items-start gap-2 text-sm font-semibold text-muted">
                <Icon name={f.icon} size={18} className="mt-0.5 shrink-0" /> {t(f.label)}
              </dt>
              <dd className="text-[15px]">{f.text}</dd>
            </div>
          ))}
        </dl>
        <Link to="/privacy" className="mt-5 inline-block text-[15px] font-semibold text-accent underline underline-offset-4">{t('about.more')}</Link>
      </section>
      <section aria-labelledby="faq-h">
        <h2 id="faq-h" className="text-2xl font-semibold">{t('faq.title')}</h2>
        <div className="mt-4 divide-y divide-line rounded-2xl border border-line bg-surface">
          {faq.map(([q, a, params]) => (
            <details key={q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {t(q)}
                <Icon name="plus" size={18} className="shrink-0 text-muted transition-transform group-open:rotate-45" />
              </summary>
              <p className="mt-2 text-[15px] text-muted">{t(a, params)}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  )
}
