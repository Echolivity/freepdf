import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { CATEGORIES, TOOLS, searchTools, toolBySlug, type Category, type ToolDef } from '../tools/registry'
import { clearRecentTools, getRecentTools } from './prefs'

const CAT_VAR: Record<Category, string> = {
  organize: 'var(--cat-organize)',
  optimize: 'var(--cat-optimize)',
  'convert-to': 'var(--cat-to)',
  'convert-from': 'var(--cat-from)',
}

export function ToolCard({ tool }: { tool: ToolDef }) {
  const color = CAT_VAR[tool.category]
  return (
    <Link
      to={`/${tool.slug}`}
      className="group relative flex h-full flex-col gap-3 rounded-2xl border border-line bg-surface p-5 transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-[0_1px_0_var(--line),0_10px_30px_-18px_rgba(0,0,0,0.35)]"
    >
      <span
        className="grid h-11 w-11 place-items-center rounded-xl"
        style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
      >
        <Icon name={tool.icon} size={24} />
      </span>
      <span className="font-display text-lg font-semibold leading-tight">{tool.title}</span>
      <span className="text-[15px] leading-snug text-muted">{tool.short}</span>
    </Link>
  )
}

function CategorySection({ cat, gridClass, wide = false }: { cat: (typeof CATEGORIES)[number]; gridClass: string; wide?: boolean }) {
  const tools = TOOLS.filter((t) => t.category === cat.id)
  if (!tools.length) return null
  return (
    <section aria-labelledby={`cat-${cat.id}`} className="mb-12">
      <div className="mb-4 flex items-baseline gap-3">
        <span className="h-2.5 w-2.5 shrink-0 translate-y-[-2px] rounded-full" style={{ background: CAT_VAR[cat.id] }} />
        <h2 id={`cat-${cat.id}`} className="text-xl font-semibold">{cat.label}</h2>
        {wide && <span className="hidden text-muted sm:inline">{cat.blurb}</span>}
      </div>
      <ul className={`grid gap-4 ${gridClass}`}>
        {tools.map((t) => <li key={t.slug}><ToolCard tool={t} /></li>)}
      </ul>
    </section>
  )
}

export function Home() {
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState(() => getRecentTools().map(toolBySlug).filter((t): t is ToolDef => !!t))
  const results = useMemo(() => searchTools(query), [query])
  const searching = query.trim().length > 0

  return (
    <>
      <section className="dot-grid border-b border-line">
        <div className="mx-auto max-w-6xl px-4 pb-12 pt-14 sm:px-6 sm:pb-16 sm:pt-20">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-sm font-semibold text-muted">
            <Icon name="shield" size={16} className="text-ok" />
            Runs in your browser — files never leave your device
          </p>
          <h1 className="max-w-3xl text-[2.6rem] font-bold leading-[1.02] sm:text-6xl lg:text-7xl">
            Every PDF tool you need. <span className="ink-underline text-accent">Completely free.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            No sign-up, no daily limits, no watermarks, no ads. Just pick a tool.
          </p>

          <div className="relative mt-8 max-w-xl">
            <label htmlFor="tool-search" className="sr-only">Search tools</label>
            <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <input
              id="tool-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tools — try “combine” or “jpg”"
              autoComplete="off"
              className="h-14 w-full rounded-2xl border border-line-strong bg-surface pl-12 pr-4 text-[17px] shadow-sm placeholder:text-muted/80 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
            />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        {!searching && recent.length > 0 && (
          <section aria-labelledby="recent-h" className="mb-12">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 id="recent-h" className="text-xl font-semibold">Recently used</h2>
              <button
                type="button"
                className="text-sm text-muted underline decoration-line-strong underline-offset-4 hover:text-ink"
                onClick={() => { clearRecentTools(); setRecent([]) }}
              >
                Clear
              </button>
            </div>
            <ul className="flex flex-wrap gap-2">
              {recent.map((t) => (
                <li key={t.slug}>
                  <Link to={`/${t.slug}`} className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[15px] font-semibold hover:border-line-strong">
                    <Icon name={t.icon} size={18} style={{ color: CAT_VAR[t.category] }} />
                    {t.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {searching ? (
          <section aria-live="polite">
            <h2 className="mb-5 text-xl font-semibold">
              {results.length ? `${results.length} tool${results.length === 1 ? '' : 's'} found` : 'No tools match that search'}
            </h2>
            {results.length > 0 ? (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {results.map((t) => <li key={t.slug}><ToolCard tool={t} /></li>)}
              </ul>
            ) : (
              <p className="text-muted">Try a different word, or browse all {TOOLS.length} tools by clearing the search.</p>
            )}
          </section>
        ) : (
          <>
            {CATEGORIES.slice(0, 1).map((cat) => (
              <CategorySection key={cat.id} cat={cat} wide gridClass="sm:grid-cols-2 lg:grid-cols-3" />
            ))}
            <div className="grid gap-x-6 lg:grid-cols-3">
              {CATEGORIES.slice(1).map((cat) => (
                <CategorySection key={cat.id} cat={cat} gridClass="sm:grid-cols-2 lg:grid-cols-1" />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}
