# Release checklist

## Before merging to `main`
- [ ] CI is green, including:
  - Chromium device projects **and** Firefox/WebKit (`ALL_BROWSERS=1`);
  - `npm audit --audit-level=high`.

  Keep the Playwright report as evidence.
- [ ] CHANGELOG and release notes are updated, and the `package.json` version is bumped.
- [ ] No tool appears on the home page unless it's complete. Roadmap items stay in docs only.
- [ ] If storage changed: update `src/app/prefs.ts` `STORAGE_KEYS`, the privacy page, `docs/PRIVACY.md`,
      README, and the allow-list in `tests/e2e/fixtures.ts`.

## On the preview deployment
- [ ] Deep links load directly: `/merge-pdf`, `/compress-pdf`, `/privacy`. `/nonexistent` shows the 404 page.
- [ ] Headers are present. Run `curl -sI https://<preview>/merge-pdf` and check for
      `content-security-policy` (with `connect-src 'self'` and `worker-src 'self'`),
      `x-content-type-options`, `referrer-policy`, `cross-origin-resource-policy` and
      `strict-transport-security`.
- [ ] Same-origin assets return 200: `/pdfjs/cmaps/`, `/pdfjs/standard_fonts/`, `/pdfjs/wasm/`,
      `/pdfjs/iccs/`, `/robots.txt`.
- [ ] **Cloudflare Web Analytics / "Automatic setup" is OFF** for the project. It injects a third-party
      beacon, which contradicts the privacy policy and is blocked by the CSP.
- [ ] One job per tool in Chrome, Safari (macOS and iOS) and Firefox, in English and Arabic.
- [ ] One large scanned PDF (100 MB or more) compressed on a real mid-range phone. Note the device in
      the release notes.
- [ ] DevTools → Network during a job: no requests except static assets.

## After promoting to production
- [ ] Custom domain serves HTTPS, and the HSTS header is present.
- [ ] `SITE_URL` is set for the build, so canonical links and the sitemap point at the real domain.
- [ ] Repeat the header check on the custom domain.
