import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ToolGlyph } from '../components/ToolGlyph'
import { CAT_VAR, CATEGORIES, TOOLS, searchTools, toolBySlug, toolKey, type Category, type ToolDef } from '../tools/registry'
import { clearRecentTools, getRecentTools } from './prefs'
import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/core'
import { useSeo } from './seo'


const toolCount = (c: Category) => TOOLS.filter((x) => x.category === c).length

/** Pairs up consecutive categories with at most two tools; others stand alone. */
function groupSmall(cats: Category[]): Category[][] {
  const out: Category[][] = []
  for (const c of cats) {
    const last = out[out.length - 1]
    if (toolCount(c) <= 2 && last?.length === 1 && toolCount(last[0]) <= 2) last.push(c)
    else out.push([c])
  }
  return out
}

/** Categories that have at least one working tool, in home-page order. */
const SHOWN = CATEGORIES.filter((c) => TOOLS.some((x) => x.category === c))

export function ToolCard({ tool }: { tool: ToolDef }) {
  const { t } = useI18n()
  const color = CAT_VAR[tool.category]
  return (
    <Link
      to={`/${tool.slug}`}
      className="group relative flex h-full items-start gap-4 overflow-hidden rounded-2xl border border-line bg-surface p-4 shadow-card transition-[border-color,box-shadow,transform] duration-200 hover:border-line-strong hover:shadow-lift motion-safe:hover:-translate-y-0.5 sm:flex-col sm:p-5"
    >
      {/* Oversized outline of the tool's own icon: gives every card its own mark. */}
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-5 -end-5 opacity-[0.07] transition-opacity duration-200 group-hover:opacity-[0.13]" style={{ color }}>
        <Icon name={tool.icon} size={112} strokeWidth={1.1} />
      </span>
      <ToolGlyph tool={tool} />
      <span className="relative flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-center gap-2 font-display text-[17px] font-semibold leading-tight sm:text-lg">
          {t(toolKey(tool.slug, 'title'))}
          <Icon name="arrowLeft" size={16} className="-scale-x-100 text-accent opacity-0 transition-[opacity,transform] duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 rtl:scale-x-100 motion-safe:group-hover:translate-x-0.5 motion-safe:rtl:group-hover:-translate-x-0.5" />
        </span>
        <span className="text-[15px] leading-snug text-muted">{t(toolKey(tool.slug, 'short'))}</span>
      </span>
    </Link>
  )
}

function CategorySection({ cat, index, compact = false }: { cat: Category; index: number; compact?: boolean }) {
  const { t } = useI18n()
  const tools = TOOLS.filter((x) => x.category === cat)
  if (!tools.length) return null
  return (
    <section aria-labelledby={`cat-${cat}`} className="mb-14 min-w-0">
      <div className="mb-5 flex items-center gap-3">
        <span aria-hidden="true" className="font-display text-sm font-semibold tabular-nums" style={{ color: CAT_VAR[cat] }}>
          {String(index + 1).padStart(2, '0')}
        </span>
        <h2 id={`cat-${cat}`} className="text-2xl font-semibold">{t(`cat.${cat}` as MessageKey)}</h2>
        <span className="hidden min-w-0 truncate text-muted md:inline">{t(`cat.${cat}.blurb` as MessageKey)}</span>
        <span aria-hidden="true" className="h-px min-w-6 flex-1 bg-line" />
      </div>
      <ul className={`grid gap-3 sm:grid-cols-2 sm:gap-4 ${compact ? '' : tools.length >= 5 ? 'lg:grid-cols-3 xl:grid-cols-5' : 'lg:grid-cols-4'}`}>
        {tools.map((x) => <li key={x.slug}><ToolCard tool={x} /></li>)}
      </ul>
    </section>
  )
}

/** Decorative hero composition: pages held inside a dashed "your device" boundary, sealed with a check. */
function HeroArt() {
  const line = (x: number, y: number, w: number, o = 1) => <rect x={x} y={y} width={w} height="5" rx="2.5" fill="var(--line-strong)" opacity={o} />
  return (
    <svg viewBox="0 0 400 380" aria-hidden="true" className="h-auto w-full max-w-[420px]">
      <rect x="14" y="14" width="372" height="352" rx="34" fill="var(--surface)" fillOpacity="0.55" stroke="var(--line-strong)" strokeWidth="1.5" strokeDasharray="6 7" />
      <g transform="rotate(-7 150 200)">
        <rect x="70" y="78" width="170" height="226" rx="10" fill="var(--surface-2)" stroke="var(--line)" />
      </g>
      <g transform="rotate(5 260 190)">
        <rect x="170" y="70" width="170" height="226" rx="10" fill="var(--surface)" stroke="var(--line)" />
        {line(192, 100, 90)}{line(192, 116, 120, 0.6)}{line(192, 130, 104, 0.6)}
        <rect x="192" y="150" width="126" height="64" rx="6" fill="color-mix(in srgb, var(--cat-to) 16%, var(--surface))" />
        {line(192, 230, 118, 0.6)}{line(192, 244, 96, 0.6)}
      </g>
      <g filter="url(#hero-shadow)">
        <path d="M118 56h128l32 32v222a10 10 0 0 1-10 10H118a10 10 0 0 1-10-10V66a10 10 0 0 1 10-10z" fill="var(--surface)" stroke="var(--line-strong)" />
        <path d="M246 56v22a10 10 0 0 0 10 10h22" fill="var(--surface-2)" stroke="var(--line-strong)" />
        <rect x="132" y="88" width="78" height="10" rx="5" fill="var(--ink)" />
        {line(132, 112, 120, 0.7)}{line(132, 126, 132, 0.7)}{line(132, 140, 100, 0.7)}
        <rect x="132" y="160" width="122" height="70" rx="8" fill="var(--accent-soft)" />
        <path d="M140 222l26-28 18 18 12-12 50 22" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
        {line(132, 246, 128, 0.7)}{line(132, 260, 112, 0.7)}{line(132, 274, 70, 0.7)}
      </g>
      <g transform="translate(262 262)">
        <circle r="38" fill="var(--accent)" />
        <circle r="38" fill="none" stroke="var(--paper)" strokeWidth="5" />
        <path d="M-15 1l10 10 20-22" fill="none" stroke="var(--on-accent)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <defs>
        <filter id="hero-shadow" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="18" stdDeviation="16" floodColor="#000" floodOpacity="0.14" />
        </filter>
      </defs>
    </svg>
  )
}

export function Home() {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Category | 'all'>('all')
  const [recent, setRecent] = useState(() => getRecentTools().map(toolBySlug).filter((x): x is ToolDef => !!x))
  const results = useMemo(() => searchTools(query), [query])
  const searching = query.trim().length > 0

  useSeo(t('app.title'), t('app.description'))

  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <div aria-hidden="true" className="dot-grid dot-grid-fade absolute inset-0" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-12 pt-12 sm:px-6 sm:pb-16 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-12 lg:pb-20">
          <div className="min-w-0">
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-sm font-semibold text-muted shadow-card">
              <Icon name="shield" size={16} className="text-ok" />
              {t('home.badge')}
            </p>
            <h1 className="text-[2.6rem] font-bold leading-[1.02] tracking-[-0.035em] sm:text-6xl lg:text-[4.4rem]">
              {t('home.h1a')}{' '}
              <span className="mt-1 block"><span className="ink-underline text-accent">{t('home.h1b')}</span></span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">{t('home.sub')}</p>

            <div className="group relative mt-9 max-w-xl">
              <label htmlFor="tool-search" className="sr-only">{t('home.searchLabel')}</label>
              <span aria-hidden="true" className="pointer-events-none absolute start-2.5 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-xl bg-accent-soft text-accent">
                <Icon name="search" size={22} />
              </span>
              <input
                id="tool-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('home.searchPlaceholder')}
                autoComplete="off"
                className="h-16 w-full rounded-2xl border border-line-strong bg-surface pe-4 ps-[4.25rem] text-[17px] shadow-lift transition-shadow placeholder:text-muted/80 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
              />
            </div>
          </div>
          <div className="hidden lg:flex lg:justify-end">
            <HeroArt />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        {!searching && recent.length > 0 && (
          <section aria-labelledby="recent-h" className="mb-12">
            <div className="mb-4 flex items-center gap-3">
              <h2 id="recent-h" className="text-lg font-semibold">{t('home.recent')}</h2>
              <span aria-hidden="true" className="h-px flex-1 bg-line" />
              <button
                type="button"
                className="rounded-md text-sm font-semibold text-muted underline decoration-line-strong underline-offset-4 hover:text-ink"
                onClick={() => { clearRecentTools(); setRecent([]) }}
              >
                {t('home.clear')}
              </button>
            </div>
            <ul className="flex flex-wrap gap-2">
              {recent.map((x) => (
                <li key={x.slug}>
                  <Link to={`/${x.slug}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-[15px] font-semibold shadow-card transition-colors hover:border-line-strong">
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
            <h2 className="mb-5 text-2xl font-semibold">
              {results.length ? t('home.found', { count: results.length }) : t('home.none')}
            </h2>
            {results.length > 0 ? (
              <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
                {results.map((x) => <li key={x.slug}><ToolCard tool={x} /></li>)}
              </ul>
            ) : (
              <p className="text-muted">{t('home.noneHint', { count: TOOLS.length })}</p>
            )}
          </section>
        ) : (
          <>
            <div
              role="group"
              aria-label={t('home.filter')}
              className="mb-10 flex flex-wrap gap-1.5 lg:w-fit lg:rounded-full lg:border lg:border-line lg:bg-surface lg:p-1.5 lg:shadow-card"
              data-testid="category-filter"
            >
              {(['all', ...SHOWN] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={filter === c}
                  onClick={() => setFilter(c)}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-[15px] font-semibold transition-colors ${
                    filter === c ? 'bg-ink text-paper shadow-card' : 'border border-line bg-surface text-ink hover:border-line-strong lg:border-transparent lg:hover:bg-surface-2'
                  }`}
                >
                  {c !== 'all' && <span className="h-2 w-2 rounded-full" style={{ background: CAT_VAR[c] }} />}
                  {c === 'all' ? t('cat.all') : t(`cat.${c}` as MessageKey)}
                  <span className={`text-sm tabular-nums ${filter === c ? 'text-paper/70' : 'text-muted'}`}>{c === 'all' ? TOOLS.length : TOOLS.filter((x) => x.category === c).length}</span>
                </button>
              ))}
            </div>
            {groupSmall(SHOWN.filter((c) => filter === 'all' || filter === c)).map((group) =>
              group.length === 1 ? (
                <CategorySection key={group[0]} cat={group[0]} index={SHOWN.indexOf(group[0])} />
              ) : (
                // Neighbouring one- or two-tool categories share a row, so short sections don't leave empty space.
                <div key={group.join()} className="grid gap-x-8 lg:grid-cols-2">
                  {group.map((c) => <CategorySection key={c} cat={c} index={SHOWN.indexOf(c)} compact />)}
                </div>
              ),
            )}
          </>
        )}
      </div>
    </>
  )
}
