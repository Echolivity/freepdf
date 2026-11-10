import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Icon, Logo } from '../components/Icon'
import { useTheme } from './prefs'
import { useI18n } from '../i18n/react'

export function Layout() {
  const [theme, toggleTheme] = useTheme()
  const { t, lang, setLang } = useI18n()
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  const navCls = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-2.5 py-2 text-[15px] font-semibold transition-colors sm:px-3 ${isActive ? 'text-ink' : 'text-muted hover:text-ink'}`

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only-focusable fixed start-3 top-3 z-50 rounded-lg bg-accent px-4 py-2 font-semibold text-on-accent">
        {t('nav.skip')}
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur supports-[backdrop-filter]:bg-paper/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-1 px-4 sm:gap-2 sm:px-6">
          <Link to="/" className="me-auto flex items-center gap-2.5 rounded-lg" aria-label={t('nav.home')}>
            <Logo className="h-8 w-8" />
            {/* The brand name stays Latin and left-to-right in both languages. */}
            <span dir="ltr" className="font-display text-[21px] font-bold tracking-tight">
              Free<span className="text-accent">PDF</span>
            </span>
          </Link>
          <nav aria-label={t('nav.main')} className="flex items-center gap-0.5">
            <NavLink to="/" end className={navCls}>{t('nav.tools')}</NavLink>
            <NavLink to="/privacy" className={`${navCls({ isActive: pathname === '/privacy' })} hidden sm:inline-block`}>{t('nav.how')}</NavLink>
          </nav>
          <button
            type="button"
            onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
            className="h-10 rounded-lg px-2.5 text-[15px] font-semibold text-muted transition-colors hover:bg-surface hover:text-ink"
            aria-label={t('lang.otherLabel')}
            lang={lang === 'ar' ? 'en' : 'ar'}
            data-testid="lang-toggle"
          >
            {t('lang.other')}
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            className="grid h-10 w-10 place-items-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-ink"
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

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="flex items-center gap-2">
            <Icon name="shield" size={18} className="shrink-0 text-ok" />
            {t('footer.local')}
          </p>
          <p className="flex items-center gap-4">
            <span>{t('footer.tagline')}</span>
            <Link to="/privacy" className="underline decoration-line-strong underline-offset-4 hover:text-ink">{t('footer.privacy')}</Link>
          </p>
        </div>
      </footer>
    </div>
  )
}
