import { useEffect } from 'react'
import { Icon, type IconName } from '../components/Icon'
import { LIMITS, LOW_MEMORY, MB } from '../config'
import { useI18n } from '../i18n/react'

const POINTS: { icon: IconName; n: 1 | 2 | 3 | 4 }[] = [
  { icon: 'cpu', n: 1 },
  { icon: 'lock', n: 2 },
  { icon: 'trash', n: 3 },
  { icon: 'shield', n: 4 },
]

export function Privacy() {
  const { t } = useI18n()
  useEffect(() => {
    document.title = t('privacy.docTitle')
  }, [t])
  return (
    <div className="mx-auto max-w-3xl px-4 pb-20 pt-12 sm:px-6">
      <h1 className="text-4xl font-bold sm:text-5xl">{t('privacy.title')}</h1>
      <p className="mt-4 text-lg text-muted">{t('privacy.intro')}</p>
      <ul className="mt-10 space-y-8">
        {POINTS.map((p) => (
          <li key={p.n} className="flex gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <Icon name={p.icon} size={22} />
            </span>
            <div>
              <h2 className="text-xl font-semibold">{t(`privacy.p${p.n}.title`)}</h2>
              <p className="mt-1.5 text-muted">{t(`privacy.p${p.n}.body`)}</p>
            </div>
          </li>
        ))}
      </ul>

      <section className="mt-14 rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-xl font-semibold">{t('privacy.server.title')}</h2>
        <p className="mt-2 text-muted">{t('privacy.server.body')}</p>
      </section>

      <section className="mt-6 rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-xl font-semibold">{t('privacy.limits.title')}</h2>
        <p className="mt-2 text-muted">
          {t('privacy.limits.body', {
            file: LIMITS.maxFileBytes / MB,
            job: LIMITS.maxJobBytes / MB,
            mp: LIMITS.maxImagePixels / 1_000_000,
            device: t(LOW_MEMORY ? 'privacy.limits.low' : 'privacy.limits.high'),
          })}
        </p>
      </section>
    </div>
  )
}
