import { test as base, expect, type Page, type Request } from '@playwright/test'

/**
 * Global privacy guard. It is an *auto* fixture, so it wraps every browser test without the test
 * opting in. It watches the whole browser context (all pages and their workers) from startup to
 * teardown, and fails the test on:
 *
 *  - any request to an origin other than the app's own;
 *  - any non-GET request, or any request carrying a body, even same-origin (CSP allows those);
 *  - any same-origin GET outside the app's static asset paths, or with a query string
 *    (catches beacons and "phone home" calls disguised as GETs);
 *  - URLs that look like they carry document data (PDF magic, long base64 runs);
 *  - known analytics/tracking hosts (reported by name for a clearer failure);
 *  - CSP violations and uncaught page errors;
 *  - persistent browser storage beyond the documented keys/values (checked at teardown).
 *
 * Documented exceptions: none are needed today. A test can allow a specific, justified pattern
 * with `allowRequests(testInfo, /pattern/, 'reason')`; the reason is recorded in the report.
 */

const STATIC_PATHS = [
  /^\/$/,
  /^\/assets\/[\w.-]+$/,
  /^\/pdfjs\/\d+\.\d+\.\d+[\w.-]*\/(cmaps|standard_fonts|wasm|iccs)\/[\w.+-]+$/,
  /^\/(favicon\.svg|theme-init\.js|robots\.txt|sitemap\.xml)$/,
  /^\/[a-z0-9-]+(\.html)?$/, // tool / page routes (prerendered app shell)
  /^\/@vite\/|^\/node_modules\/|^\/src\//, // dev server only (not used by the preview build)
]

const TRACKERS =
  /google-analytics|googletagmanager|doubleclick|facebook\.net|connect\.facebook|segment\.(io|com)|hotjar|mixpanel|amplitude|plausible|matomo|sentry|datadog|newrelic|cloudflareinsights|clarity\.ms|fullstory|posthog|intercom/i

const ALLOWED_STORAGE: Record<string, (v: string) => boolean> = {
  'freepdf:theme': (v) => v === 'light' || v === 'dark',
  'freepdf:lang': (v) => v === 'en' || v === 'ar',
  'freepdf:recent': (v) => {
    try {
      const a = JSON.parse(v)
      return Array.isArray(a) && a.length <= 6 && a.every((s) => typeof s === 'string' && /^[a-z0-9-]{3,40}$/.test(s))
    } catch {
      return false
    }
  },
}

type Allow = { pattern: RegExp; reason: string }
const allowances = new WeakMap<object, Allow[]>()

export function allowRequests(testInfo: { annotations: { type: string; description?: string }[] }, pattern: RegExp, reason: string) {
  const list = allowances.get(testInfo) ?? []
  list.push({ pattern, reason })
  allowances.set(testInfo, list)
  testInfo.annotations.push({ type: 'privacy-guard-exception', description: `${pattern} — ${reason}` })
}

export function inspectRequest(req: Request, appOrigin: string): string | null {
  const url = req.url()
  if (/^(data|blob|about):/.test(url)) return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return `unparseable request URL: ${url}`
  }
  if (TRACKERS.test(u.hostname)) return `tracking/analytics host contacted: ${u.hostname}`
  if (u.origin !== appOrigin) return `request to external origin: ${req.method()} ${url}`
  if (req.method() !== 'GET') return `non-GET request: ${req.method()} ${url}`
  const body = req.postDataBuffer()
  if (body && body.length) return `request with a body (${body.length} bytes): ${url}`
  if (u.search) return `same-origin request with a query string: ${url}`
  if (!STATIC_PATHS.some((p) => p.test(u.pathname))) return `unexpected same-origin path: ${u.pathname}`
  if (/%PDF|JVBERi0|[A-Za-z0-9+/=_-]{200,}/.test(url)) return `URL appears to carry document data: ${url.slice(0, 120)}…`
  return null
}

async function inspectStorage(page: Page, appOrigin: string): Promise<string[]> {
  if (page.isClosed() || !page.url().startsWith(appOrigin)) return []
  const snapshot = await page
    .evaluate(async () => ({
      local: Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k) ?? ''])),
      session: Object.keys(sessionStorage),
      idb: (await indexedDB.databases?.())?.map((d) => d.name ?? '') ?? [],
      caches: 'caches' in window ? await caches.keys() : [],
      sw: (await navigator.serviceWorker?.getRegistrations())?.length ?? 0,
      cookies: document.cookie,
    }))
    .catch(() => null)
  if (!snapshot) return []
  const problems: string[] = []
  for (const [k, v] of Object.entries(snapshot.local)) {
    const ok = ALLOWED_STORAGE[k]
    if (!ok) problems.push(`undocumented localStorage key: ${k}`)
    else if (!ok(v)) problems.push(`unexpected value for ${k}: ${v.slice(0, 80)}`)
  }
  if (snapshot.session.length) problems.push(`sessionStorage used: ${snapshot.session.join(', ')}`)
  if (snapshot.idb.length) problems.push(`IndexedDB databases created: ${snapshot.idb.join(', ')}`)
  if (snapshot.caches.length) problems.push(`Cache Storage used: ${snapshot.caches.join(', ')}`)
  if (snapshot.sw) problems.push('a service worker was registered')
  if (snapshot.cookies) problems.push(`cookies set: ${snapshot.cookies}`)
  return problems
}

export const test = base.extend<{ privacyGuard: void }>({
  privacyGuard: [
    async ({ context, baseURL }, use, testInfo) => {
      const appOrigin = new URL(baseURL ?? 'http://localhost:4173').origin
      const violations: string[] = []
      const allowed = () => allowances.get(testInfo) ?? []
      const allowPageErrors = testInfo.annotations.some((a) => a.type === 'allow-page-errors')

      context.on('request', (req) => {
        const problem = inspectRequest(req, appOrigin)
        if (problem && !allowed().some((a) => a.pattern.test(req.url()))) violations.push(problem)
      })
      const watch = (page: Page) => {
        page.on('pageerror', (e) => { if (!allowPageErrors) violations.push(`uncaught page error: ${e.message}`) })
        page.on('console', (m) => {
          if (m.type() === 'error' && /Content Security Policy|Refused to (connect|load|execute|frame)/i.test(m.text())) violations.push(`CSP violation: ${m.text()}`)
        })
      }
      context.pages().forEach(watch)
      context.on('page', watch)

      await use()

      for (const page of context.pages()) violations.push(...(await inspectStorage(page, appOrigin)))
      expect(violations, `Privacy guard:\n${violations.join('\n')}`).toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
