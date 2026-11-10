import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { readFileSync, writeFileSync } from 'node:fs'
import { en } from './src/i18n/en.ts'
import type { Plugin } from 'vite'

/** Apply the production headers from public/_headers to `vite preview`, so E2E tests run under the real CSP. */
function productionHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  let inRoot = false
  for (const line of readFileSync(new URL('./public/_headers', import.meta.url), 'utf8').split('\n')) {
    if (!line.trim()) continue
    if (!/^\s/.test(line)) { inRoot = line.trim() === '/*'; continue }
    if (!inRoot) continue
    const i = line.indexOf(':')
    // upgrade-insecure-requests would break plain-http localhost testing
    headers[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/;\s*upgrade-insecure-requests/, '')
  }
  return headers
}

/**
 * Emit a copy of index.html for every route (merge-pdf.html, privacy.html, 404.html …) so deep links
 * work on any static host — Cloudflare Pages, Workers static assets / Cloudflare Drop, or others —
 * without host-specific SPA fallback settings. Each copy gets its own <title>, description and Open
 * Graph tags. With SITE_URL set (e.g. https://freepdf.example), canonical links, sitemap.xml and the
 * robots.txt Sitemap line are emitted too; without it they are omitted rather than guessed.
 */
function staticRoutes(): Plugin {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return {
    name: 'freepdf-static-routes',
    apply: 'build',
    closeBundle() {
      const registry = readFileSync(new URL('./src/tools/registry.ts', import.meta.url), 'utf8')
      const slugs = [...registry.matchAll(/slug: '([a-z0-9-]+)'/g)].map((m) => m[1])
      if (slugs.length < 5) throw new Error('static-routes: could not read tool slugs from registry.ts')
      const site = (process.env.SITE_URL || '').replace(/\/+$/, '')
      if (site && !/^https:\/\/[^/]+$/.test(site)) throw new Error(`SITE_URL must look like https://example.com (got ${site})`)
      const dist = new URL('./dist/', import.meta.url)
      const shell = readFileSync(new URL('index.html', dist), 'utf8')
      const page = (path: string, title: string, description: string, withCanonical = true) => {
        let html = shell
          .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
          .replace(/(<meta name="description" content=")[^"]*/, `$1${esc(description)}`)
          .replace(/(<meta property="og:title" content=")[^"]*/, `$1${esc(title)}`)
          .replace(/(<meta property="og:description" content=")[^"]*/, `$1${esc(description)}`)
        const canonical = site && withCanonical ? `<link rel="canonical" href="${site}${path}" />\n    <meta property="og:url" content="${site}${path}" />` : ''
        html = html.replace('<!--seo:canonical-->', canonical)
        return html
      }
      const routes: [string, string, string, string][] = [
        ['index', '/', en['app.title'], en['app.description']],
        ['privacy', '/privacy', en['privacy.docTitle'], en['privacy.intro']],
        ...slugs.map((slug): [string, string, string, string] => [
          slug,
          `/${slug}`,
          en['app.toolTitle'].replace('{title}', en[`tool.${slug}.title` as keyof typeof en] as string),
          en[`tool.${slug}.description` as keyof typeof en] as string,
        ]),
      ]
      for (const [file, path, title, description] of routes) writeFileSync(new URL(`${file}.html`, dist), page(path, title, description))
      const notFound = page('/404', en['nf.title'] + ' — FreePDF', en['nf.body'], false)
      writeFileSync(new URL('404.html', dist), notFound.replace('<meta name="description"', '<meta name="robots" content="noindex" />\n    <meta name="description"'))
      writeFileSync(new URL('robots.txt', dist), `User-agent: *\nAllow: /\n${site ? `Sitemap: ${site}/sitemap.xml\n` : ''}`)
      if (site) {
        const urls = routes.map(([, path]) => `  <url><loc>${site}${path === '/' ? '/' : path}</loc></url>`).join('\n')
        writeFileSync(new URL('sitemap.xml', dist), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`)
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), staticRoutes()],
  worker: { format: 'es' },
  preview: { headers: productionHeaders() },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
})
