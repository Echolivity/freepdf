import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Icon, Logo } from '../components/Icon'
import { useTheme } from './prefs'
import { useI18n } from '../i18n/context'

export function Layout() {
  const [theme, toggleTheme] = useTheme()
  const { t, lang, setLang } = useI18n()
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  const navCls = ({ isActive }: { isActive: boolean }) =>
    `relative h-10 items-center rounded-full px-3 text-[15px] font-semibold transition-colors ${
      isActive ? 'bg-surface text-ink shadow-card ring-1 ring-line' : 'text-muted hover:text-ink'
    }`
  const ctrlCls = 'inline-flex h-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink'

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only-focusable fixed start-3 top-3 z-50 rounded-lg bg-accent px-4 py-2 font-semibold text-on-accent">
        {t('nav.skip')}
      </a>
      <header className="sticky top-0 z-40 border-b border-line/80 bg-paper/85 backdrop-blur-md supports-[backdrop-filter]:bg-paper/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-1 px-4 sm:gap-2 sm:px-6">
          <Link to="/" className="me-auto flex items-center gap-2.5 rounded-lg" aria-label={t('nav.home')}>
            <Logo className="h-8 w-8" />
            {/* The brand name stays Latin and left-to-right in both languages. */}
            <span dir="ltr" className="font-display text-[21px] font-bold tracking-tight">
              Free<span className="text-accent">PDF</span>
            </span>
          </Link>
          <nav aria-label={t('nav.main')} className="flex items-center gap-1">
            <NavLink to="/" end className={(a) => `${navCls(a)} inline-flex`}>{t('nav.tools')}</NavLink>
            <NavLink to="/privacy" className={`${navCls({ isActive: pathname === '/privacy' })} hidden sm:inline-flex`}>{t('nav.how')}</NavLink>
          </nav>
          <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-line-strong sm:block" />
          <button
            type="button"
            onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
            className={`${ctrlCls} px-3 text-[15px] font-semibold`}
            // The visible language name (in its own language) is the accessible name (WCAG 2.5.3);
            // the longer description goes in the tooltip.
            title={t('lang.otherLabel')}
            lang={lang === 'ar' ? 'en' : 'ar'}
            data-testid="lang-toggle"
          >
            {t('lang.other')}
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            data-testid="theme-toggle"
            className={`${ctrlCls} w-10`}
            aria-label={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}
            title={theme === 'dark' ? t('theme.light') : t('theme.dark')}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </div>
      </header>

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      <footer className="mt-8 border-t border-line bg-surface-2/60">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:items-end">
          <div className="space-y-4">
            <Link to="/" className="inline-flex items-center gap-2 rounded-lg">
              <Logo className="h-7 w-7" />
              <span dir="ltr" className="font-display text-lg font-bold tracking-tight">Free<span className="text-accent">PDF</span></span>
            </Link>
            <p className="flex max-w-md items-start gap-2 text-[15px] text-ink">
              <Icon name="shield" size={18} className="mt-0.5 shrink-0 text-ok" />
              {t('footer.local')}
            </p>
          </div>
          <div className="space-y-3 text-sm text-muted md:text-end">
            <p className="flex flex-wrap gap-x-5 gap-y-2 md:justify-end">
              <Link to="/" className="font-semibold text-ink hover:text-accent">{t('nav.tools')}</Link>
              <Link to="/privacy" className="font-semibold text-ink hover:text-accent">{t('footer.privacy')}</Link>
            </p>
            <p>{t('footer.tagline')}</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
