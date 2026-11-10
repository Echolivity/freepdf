import { Suspense, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toolBySlug, toolKey } from '../tools/registry'
import { recordRecentTool } from './prefs'
import { NotFound } from './NotFound'
import { Icon } from '../components/Icon'
import { useI18n } from '../i18n/react'

export function ToolPage() {
  const { slug = '' } = useParams()
  const tool = toolBySlug(slug.replace(/\.html$/, ''))
  const { t } = useI18n()

  useEffect(() => {
    if (tool) recordRecentTool(tool.slug)
  }, [tool])

  useEffect(() => {
    document.title = tool ? t('app.toolTitle', { title: t(toolKey(tool.slug, 'title')) }) : t('app.title')
  }, [tool, t])

  if (!tool) return <NotFound />
  const Component = tool.component

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
      <Link to="/" className="mb-6 inline-flex items-center gap-1.5 rounded-lg text-[15px] font-semibold text-muted hover:text-ink">
        <Icon name="arrowLeft" size={18} className="rtl:-scale-x-100" /> {t('tool.allTools')}
      </Link>
      <header className="mb-8">
        <h1 className="text-4xl font-bold sm:text-5xl">{t(toolKey(tool.slug, 'title'))}</h1>
        <p className="mt-3 max-w-2xl text-lg text-muted">{t(toolKey(tool.slug, 'description'))}</p>
      </header>
      {/* key: navigating between tools sharing a component (JPG/PNG) fully resets state */}
      <Suspense fallback={<p role="status" className="py-16 text-center text-muted">{t('tool.loading')}</p>}>
        <Component key={tool.slug} tool={tool} />
      </Suspense>
    </div>
  )
}
