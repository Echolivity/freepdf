import { Suspense, useEffect } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { CAT_VAR, RENAMED, toolBySlug, toolKey } from '../tools/registry'
import { recordRecentTool } from './prefs'
import { NotFound } from './NotFound'
import { Icon } from '../components/Icon'
import { useI18n } from '../i18n/context'
import { ToolAbout } from './ToolAbout'
import { useSeo } from './seo'
import { ToolGlyph } from '../components/ToolGlyph'
import type { MessageKey } from '../i18n/core'

export function ToolPage() {
  const { slug = '' } = useParams()
  const tool = toolBySlug(slug.replace(/\.html$/, ''))
  const { t } = useI18n()

  useEffect(() => {
    if (tool) recordRecentTool(tool.slug)
  }, [tool])

  useSeo(
    tool ? t('app.toolTitle', { title: t(toolKey(tool.slug, 'title')) }) : t('app.title'),
    tool ? t(toolKey(tool.slug, 'description')) : t('app.description'),
  )

  const renamed = RENAMED[slug.replace(/\.html$/, '')]
  if (renamed) return <Navigate to={`/${renamed}`} replace />
  if (!tool) return <NotFound />
  const Component = tool.component

  return (
    <>
      <div className="relative overflow-hidden border-b border-line">
        <div aria-hidden="true" className="dot-grid dot-grid-fade absolute inset-0" />
        <div className="relative mx-auto max-w-5xl px-4 pb-9 pt-7 sm:px-6 sm:pb-11 sm:pt-10">
          <nav aria-label={t('tool.breadcrumb')} className="mb-7 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px]">
            <Link to="/" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg font-semibold text-muted hover:text-ink">
              <Icon name="arrowLeft" size={18} className="rtl:-scale-x-100" /> {t('tool.allTools')}
            </Link>
            <span aria-hidden="true" className="text-line-strong">/</span>
            <span className="inline-flex items-center gap-2 text-muted">
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: CAT_VAR[tool.category] }} />
              {t(`cat.${tool.category}` as MessageKey)}
            </span>
          </nav>
          <header className="flex items-start gap-5">
            <span className="hidden pt-1 sm:block"><ToolGlyph tool={tool} size="lg" /></span>
            <div className="min-w-0">
              <h1 className="text-4xl font-bold tracking-[-0.03em] sm:text-5xl">{t(toolKey(tool.slug, 'title'))}</h1>
              <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">{t(toolKey(tool.slug, 'description'))}</p>
            </div>
          </header>
        </div>
      </div>
      <div className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
        {/* key: navigating between tools sharing a component (JPG/PNG) fully resets state */}
        <Suspense fallback={<p role="status" className="py-16 text-center text-muted">{t('tool.loading')}</p>}>
          <Component key={tool.slug} tool={tool} />
        </Suspense>
        <ToolAbout tool={tool} />
      </div>
    </>
  )
}
