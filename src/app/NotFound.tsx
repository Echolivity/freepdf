import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/context'

export function NotFound() {
  const { t } = useI18n()
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="font-display text-7xl font-bold text-accent">404</p>
      <h1 className="mt-4 text-3xl font-bold">{t('nf.title')}</h1>
      <p className="mt-3 text-muted">{t('nf.body')}</p>
      <Link to="/" className="mt-8 inline-flex min-h-12 items-center rounded-xl bg-accent px-5 font-semibold text-on-accent shadow-glow hover:bg-accent-hover">
        {t('nf.cta')}
      </Link>
    </div>
  )
}
