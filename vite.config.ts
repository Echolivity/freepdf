import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { copyFileSync, readFileSync } from 'node:fs'
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
 * without relying on host-specific single-page-app fallback settings.
 */
function staticRoutes(): Plugin {
  return {
    name: 'freepdf-static-routes',
    apply: 'build',
    closeBundle() {
      const registry = readFileSync(new URL('./src/tools/registry.ts', import.meta.url), 'utf8')
      const slugs = [...registry.matchAll(/slug: '([a-z0-9-]+)'/g)].map((m) => m[1])
      if (slugs.length < 5) throw new Error('static-routes: could not read tool slugs from registry.ts')
      const dist = new URL('./dist/', import.meta.url)
      for (const route of [...slugs, 'privacy', '404']) copyFileSync(new URL('index.html', dist), new URL(`${route}.html`, dist))
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
