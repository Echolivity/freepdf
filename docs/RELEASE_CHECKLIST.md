# Release checklist

## Before merging to `main`
- [ ] CI green: typecheck, lint, unit, build, E2E. Keep the Playwright report as evidence.
- [ ] CHANGELOG updated and `package.json` version bumped.
- [ ] Every tool on the home page works; no new tool is listed unless it is complete.

## On the preview deployment (PR URL)
- [ ] Deep links load directly: `/merge-pdf`, `/compress-pdf`, `/privacy`, `/nonexistent` (shows the 404 page).
- [ ] Headers present: `curl -sI https://<preview>/merge-pdf` shows `content-security-policy`,
      `x-content-type-options`, `referrer-policy`, `strict-transport-security`.
- [ ] Same-origin assets: `/pdfjs/cmaps/`, `/pdfjs/standard_fonts/`, `/pdfjs/wasm/` and `/pdfjs/iccs/` return 200.
- [ ] One job per tool in Chrome, Safari (macOS + iOS) and Firefox.
- [ ] One large scanned PDF (100 MB or more) compressed on a mid-range phone.
- [ ] DevTools Network tab during a job: no requests except static assets.

## After promoting to production
- [ ] Custom domain serves HTTPS and HSTS.
- [ ] Repeat the header check on the custom domain.
