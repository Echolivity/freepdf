import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { CATEGORIES, TOOLS, searchTools, toolBySlug, toolKey, type Category, type ToolDef } from '../tools/registry'
import { clearRecentTools, getRecentTools } from './prefs'
import { useI18n } from '../i18n/react'
import type { MessageKey } from '../i18n/core'
import { useSeo } from './seo'

export const CAT_VAR: Record<Category, string> = {
  organize: 'var(--cat-organize)',
  optimize: 'var(--cat-optimize)',
  'convert-to': 'var(--cat-to)',
  'convert-from': 'var(--cat-from)',
}

export function ToolCard({ tool }: { tool: ToolDef }) {
  const { t } = useI18n()
  const color = CAT_VAR[tool.category]
  return (
    <Link
      to={`/${tool.slug}`}
      className="group relative flex h-full flex-col gap-3 rounded-2xl border border-line bg-surface p-5 transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-[0_1px_0_var(--line),0_10px_30px_-18px_rgba(0,0,0,0.35)]"
    >
      <span className="grid h-11 w-11 place-items-center rounded-xl" style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
        <Icon name={tool.icon} size={24} />
      </span>
      <span className="font-display text-lg font-semibold leading-tight">{t(toolKey(tool.slug, 'title'))}</span>
      <span className="text-[15px] leading-snug text-muted">{t(toolKey(tool.slug, 'short'))}</span>
    </Link>
  )
}

function CategorySection({ cat, gridClass, wide = false }: { cat: Category; gridClass: string; wide?: boolean }) {
  const { t } = useI18n()
  const tools = TOOLS.filter((x) => x.category === cat)
  if (!tools.length) return null
  return (
    <section aria-labelledby={`cat-${cat}`} className="mb-12">
      <div className="mb-4 flex items-baseline gap-3">
        <span className="h-2.5 w-2.5 shrink-0 translate-y-[-2px] rounded-full" style={{ background: CAT_VAR[cat] }} />
        <h2 id={`cat-${cat}`} className="text-xl font-semibold">{t(`cat.${cat}` as MessageKey)}</h2>
        {wide && <span className="hidden text-muted sm:inline">{t(`cat.${cat}.blurb` as MessageKey)}</span>}
      </div>
      <ul className={`grid gap-4 ${gridClass}`}>
        {tools.map((x) => <li key={x.slug}><ToolCard tool={x} /></li>)}
      </ul>
    </section>
  )
}

export function Home() {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState(() => getRecentTools().map(toolBySlug).filter((x): x is ToolDef => !!x))
  const results = useMemo(() => searchTools(query), [query])
  const searching = query.trim().length > 0

  useSeo(t('app.title'), t('app.description'))

  return (
    <>
      <section className="dot-grid border-b border-line">
        <div className="mx-auto max-w-6xl px-4 pb-12 pt-14 sm:px-6 sm:pb-16 sm:pt-20">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-sm font-semibold text-muted">
            <Icon name="shield" size={16} className="text-ok" />
            {t('home.badge')}
          </p>
          <h1 className="max-w-4xl text-[2.5rem] font-bold leading-[1.05] sm:text-6xl lg:text-[4.25rem]">
            {t('home.h1a')}{' '}
            <span className="mt-1 block"><span className="ink-underline text-accent">{t('home.h1b')}</span></span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">{t('home.sub')}</p>

          <div className="relative mt-8 max-w-xl">
            <label htmlFor="tool-search" className="sr-only">{t('home.searchLabel')}</label>
            <Icon name="search" className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-muted" />
            <input
              id="tool-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('home.searchPlaceholder')}
              autoComplete="off"
              className="h-14 w-full rounded-2xl border border-line-strong bg-surface pe-4 ps-12 text-[17px] shadow-sm placeholder:text-muted/80 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
            />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        {!searching && recent.length > 0 && (
          <section aria-labelledby="recent-h" className="mb-12">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 id="recent-h" className="text-xl font-semibold">{t('home.recent')}</h2>
              <button
                type="button"
                className="text-sm text-muted underline decoration-line-strong underline-offset-4 hover:text-ink"
                onClick={() => { clearRecentTools(); setRecent([]) }}
              >
                {t('home.clear')}
              </button>
            </div>
            <ul className="flex flex-wrap gap-2">
              {recent.map((x) => (
                <li key={x.slug}>
                  <Link to={`/${x.slug}`} className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[15px] font-semibold hover:border-line-strong">
                    <Icon name={x.icon} size={18} style={{ color: CAT_VAR[x.category] }} />
                    {t(toolKey(x.slug, 'title'))}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {searching ? (
          <section aria-live="polite">
            <h2 className="mb-5 text-xl font-semibold">
              {results.length ? t('home.found', { count: results.length }) : t('home.none')}
            </h2>
            {results.length > 0 ? (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {results.map((x) => <li key={x.slug}><ToolCard tool={x} /></li>)}
              </ul>
            ) : (
              <p className="text-muted">{t('home.noneHint', { count: TOOLS.length })}</p>
            )}
          </section>
        ) : (
          <>
            <CategorySection cat={CATEGORIES[0]} wide gridClass="sm:grid-cols-2 lg:grid-cols-3" />
            <div className="grid gap-x-6 lg:grid-cols-3">
              {CATEGORIES.slice(1).map((cat) => (
                <CategorySection key={cat} cat={cat} gridClass="sm:grid-cols-2 lg:grid-cols-1" />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}
