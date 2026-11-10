import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

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

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  preview: { headers: productionHeaders() },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
})
