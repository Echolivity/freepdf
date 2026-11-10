import { Suspense, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toolBySlug } from '../tools/registry'
import { recordRecentTool } from './prefs'
import { NotFound } from './NotFound'
import { Icon } from '../components/Icon'

export function ToolPage() {
  const { slug = '' } = useParams()
  const tool = toolBySlug(slug)

  useEffect(() => {
    if (tool) {
      recordRecentTool(tool.slug)
      document.title = `${tool.title} — FreePDF`
    }
    return () => { document.title = 'FreePDF — Every PDF tool you need. Completely free.' }
  }, [tool])

  if (!tool) return <NotFound />
  const Component = tool.component

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
      <Link to="/" className="mb-6 inline-flex items-center gap-1.5 rounded-lg text-[15px] font-semibold text-muted hover:text-ink">
        <Icon name="arrowLeft" size={18} /> All tools
      </Link>
      <header className="mb-8">
        <h1 className="text-4xl font-bold sm:text-5xl">{tool.title}</h1>
        <p className="mt-3 max-w-2xl text-lg text-muted">{tool.description}</p>
      </header>
      {/* key: navigating between tools sharing a component (JPG/PNG) fully resets state */}
      <Suspense fallback={<p role="status" className="py-16 text-center text-muted">Loading tool…</p>}>
        <Component key={tool.slug} tool={tool} />
      </Suspense>
    </div>
  )
}
