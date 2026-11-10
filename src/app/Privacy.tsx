import { useState } from 'react'
import { useSeo } from './seo'
import { Icon, type IconName } from '../components/Icon'
import { LIMIT_PROFILES, LIMITS, LOW_MEMORY, MB } from '../config'
import { useI18n } from '../i18n/react'
import { clearAllSettings, STORAGE_KEYS } from './prefs'
import type { MessageKey } from '../i18n/core'

const POINTS: { icon: IconName; n: 1 | 2 | 3 | 4 }[] = [
  { icon: 'cpu', n: 1 },
  { icon: 'lock', n: 2 },
  { icon: 'trash', n: 3 },
  { icon: 'shield', n: 4 },
]

const STORAGE_TEXT: Record<(typeof STORAGE_KEYS)[number], MessageKey> = {
  'freepdf:theme': 'privacy.storage.theme',
  'freepdf:lang': 'privacy.storage.lang',
  'freepdf:recent': 'privacy.storage.recent',
}

export function LimitsTable() {
  const { t } = useI18n()
  const rows: [MessageKey, string, string][] = [
    ['privacy.limits.file', `${LIMIT_PROFILES.standard.maxFileBytes / MB} MB`, `${LIMIT_PROFILES.constrained.maxFileBytes / MB} MB`],
    ['privacy.limits.job', `${LIMIT_PROFILES.standard.maxJobBytes / MB} MB`, `${LIMIT_PROFILES.constrained.maxJobBytes / MB} MB`],
    ['privacy.limits.files', String(LIMITS.maxFiles), String(LIMITS.maxFiles)],
    ['privacy.limits.pixels', t('privacy.limits.mp', { n: LIMITS.maxImagePixels / 1e6 }), t('privacy.limits.mp', { n: LIMITS.maxImagePixels / 1e6 })],
  ]
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-start text-[15px]">
        <thead>
          <tr className="border-b border-line text-sm text-muted">
            <th scope="col" className="py-2 pe-4 text-start font-semibold">{t('privacy.limits.item')}</th>
            <th scope="col" className="py-2 pe-4 text-start font-semibold">{t('privacy.limits.standard')}</th>
            <th scope="col" className="py-2 text-start font-semibold">{t('privacy.limits.constrained')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, a, b]) => (
            <tr key={k} className="border-b border-line last:border-0">
              <th scope="row" className="py-2 pe-4 text-start font-normal">{t(k)}</th>
              <td className="py-2 pe-4"><bdi dir="ltr">{a}</bdi></td>
              <td className="py-2"><bdi dir="ltr">{b}</bdi></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-sm text-muted" data-testid="device-limits">
        {t('privacy.limits.yours', { kind: t(LOW_MEMORY ? 'privacy.limits.yoursLow' : 'privacy.limits.yoursStd') })}
      </p>
    </div>
  )
}

export function Privacy() {
  const { t } = useI18n()
  const [cleared, setCleared] = useState(false)
  useSeo(t('privacy.docTitle'), t('privacy.intro'))
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

      <section className="mt-14 rounded-2xl border border-line bg-surface p-6" aria-labelledby="storage-h">
        <h2 id="storage-h" className="text-xl font-semibold">{t('privacy.storage.title')}</h2>
        <p className="mt-2 text-muted">{t('privacy.storage.body')}</p>
        <table className="mt-4 w-full text-[15px]">
          <thead>
            <tr className="border-b border-line text-sm text-muted">
              <th scope="col" className="py-2 pe-4 text-start font-semibold">{t('privacy.storage.key')}</th>
              <th scope="col" className="py-2 text-start font-semibold">{t('privacy.storage.what')}</th>
            </tr>
          </thead>
          <tbody>
            {STORAGE_KEYS.map((k) => (
              <tr key={k} className="border-b border-line last:border-0">
                <th scope="row" className="py-2 pe-4 text-start align-top font-normal"><code dir="ltr" className="text-sm">{k}</code></th>
                <td className="py-2">{t(STORAGE_TEXT[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-sm text-muted">{t('privacy.storage.none')}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => { clearAllSettings(); setCleared(true) }}
            className="rounded-xl border border-line-strong bg-surface px-4 py-2 text-[15px] font-semibold hover:border-ink/40"
          >
            {t('privacy.storage.clear')}
          </button>
          {cleared && <span role="status" className="text-sm text-ok">{t('privacy.storage.cleared')}</span>}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-line bg-surface p-6" aria-labelledby="limits-h">
        <h2 id="limits-h" className="text-xl font-semibold">{t('privacy.limits.title')}</h2>
        <p className="mt-2 mb-4 text-muted">{t('privacy.limits.body')}</p>
        <LimitsTable />
      </section>

      <section className="mt-6 rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-xl font-semibold">{t('privacy.server.title')}</h2>
        <p className="mt-2 text-muted">{t('privacy.server.body')}</p>
      </section>
    </div>
  )
}
