// Runs the Playwright suite against the production build served by Cloudflare's own local Pages
// runtime (`wrangler pages dev` → workerd). This validates real Pages behaviour: _headers, routing and
// HTML handling (/route → route.html, trailing-slash redirects), 404.html, MIME types and caching.
// Usage: npm run build && npm run test:cloudflare [-- extra playwright args]
import { spawn } from 'node:child_process'

const PORT = 8788
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: process.env.CI ?? '' }
const server = spawn('npx', ['wrangler', 'pages', 'dev', 'dist', '--port', String(PORT), '--ip', '127.0.0.1'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
server.stdout.on('data', (d) => (log += d))
server.stderr.on('data', (d) => (log += d))

const ready = async () => {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return true
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

if (!(await ready())) {
  console.error('wrangler pages dev did not start:\n' + log)
  server.kill('SIGTERM')
  process.exit(1)
}
// With --config (e.g. the QA harness) the target config decides its own projects.
const extra = process.argv.slice(2)
const args = ['playwright', 'test', ...(extra.some((a) => a.startsWith('--config')) ? [] : ['--project=desktop']), ...extra]
const pw = spawn('npx', args, { env: { ...env, PW_BASE_URL: `http://127.0.0.1:${PORT}` }, stdio: 'inherit' })
pw.on('exit', (code) => {
  server.kill('SIGTERM')
  process.exit(code ?? 1)
})
