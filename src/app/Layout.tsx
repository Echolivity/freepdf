import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Icon, Logo } from '../components/Icon'
import { useTheme } from './prefs'

export function Layout() {
  const [theme, toggleTheme] = useTheme()
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  const navCls = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-[15px] font-semibold transition-colors ${isActive ? 'text-ink' : 'text-muted hover:text-ink'}`

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only-focusable fixed left-3 top-3 z-50 rounded-lg bg-accent px-4 py-2 font-semibold text-on-accent">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur supports-[backdrop-filter]:bg-paper/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:px-6">
          <Link to="/" className="mr-auto flex items-center gap-2.5 rounded-lg" aria-label="FreePDF home">
            <Logo className="h-8 w-8" />
            <span className="font-display text-[21px] font-bold tracking-tight">
              Free<span className="text-accent">PDF</span>
            </span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-0.5">
            <NavLink to="/" end className={navCls}>Tools</NavLink>
            <NavLink to="/privacy" className={navCls}>How it works</NavLink>
          </nav>
          <button
            type="button"
            onClick={toggleTheme}
            className="ml-1 grid h-10 w-10 place-items-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-ink"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
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
            <Icon name="shield" size={18} className="text-ok" />
            Your files are processed on your device and never uploaded.
          </p>
          <p className="flex items-center gap-4">
            <span>No accounts · No limits · No ads</span>
            <Link to="/privacy" className="underline decoration-line-strong underline-offset-4 hover:text-ink">Privacy</Link>
          </p>
        </div>
      </footer>
    </div>
  )
}
