# Release checklist — 1.0.0

Status key: **PASS** = executed with evidence · **FAIL** · **BLOCKED** = couldn't be executed in the
release environment (reason given) · **NOT TESTED** = needs hardware, accounts or a person.
Evidence is in [TEST_AND_QA_REPORT.md](TEST_AND_QA_REPORT.md) unless noted. Run date: 2026-11-11.

## Source and build

| # | Item | Status |
|---|------|--------|
| 1 | `package.json` and `package-lock.json` both at 1.0.0; `npm ci` in a fresh clone succeeds and leaves the tree unchanged | PASS |
| 2 | No nested or obsolete archives in the repository (`freepdf-phase1.zip` removed; `*.zip` ignored) | PASS |
| 3 | No secrets, personal data, local settings or machine-specific paths in tracked files (fixtures use "anonymous"/fictional metadata and a "FreePDF Test Signer" certificate) | PASS |
| 4 | `npm audit --audit-level=high`: 0 vulnerabilities | PASS |
| 5 | Typecheck and lint: 0 errors, 0 warnings | PASS |
| 6 | Production build; homepage JS 97.5 KB gzipped | PASS |

## Automated tests

| # | Item | Status |
|---|------|--------|
| 7 | Unit/integration, `CI=1` (qpdf mandatory): 110 / 110 | PASS |
| 8 | Browser, 5 Chromium device profiles, `CI=1` (flaky = fail): 180 passed, 1 Cloudflare-only skip | PASS |
| 9 | Browser inside Cloudflare's Pages runtime: 72 / 72 | PASS |
| 10 | Real-world QA inside the Cloudflare runtime, strict validators: 30 / 30 | PASS |
| 11 | QA failure propagation (an injected FAIL row exits 1; a missing qpdf errors in strict mode) | PASS |
| 12 | Embedded PDF JavaScript never executes (Chromium: 3 tools; WebKitGTK: Organize) | PASS |
| 13 | No file names or document data in console output (guard + 2 self-tests) | PASS |
| 14 | Route crawl EN/AR: no console errors, no 4xx/5xx; real 404 + `noindex` on Cloudflare | PASS |
| 15 | Accessibility (axe WCAG 2.1 AA, EN/AR, light/dark; keyboard flow) | PASS (Chromium) |
| 16 | WebKit engine (WebKitGTK 2.52) smoke: 10/10 on preview and 10/10 on the Cloudflare runtime over HTTPS | PASS |
| 17 | Playwright Firefox, WebKit, iPad and iPhone SE projects | BLOCKED: browser downloads refused by the sandbox network policy. **Must be green in CI (`cross-engine`) before tagging.** |
| 18 | Firefox in any form | BLOCKED: no Firefox source reachable. Covered by item 17 in CI. |
| 19 | CI workflow is valid (`actionlint`) and runs every suite above | PASS (lint); the workflow has not run on GitHub yet |

## Release package

| # | Item | Status |
|---|------|--------|
| 20 | Source ZIP built with `git archive` from the release commit: no `.git`, `node_modules`, `dist`, test output, `.wrangler`, `.env` or nested archives | PASS |
| 21 | Source ZIP unpacks, `npm ci`, unit tests and build all pass | PASS |
| 22 | Dist ZIP contains only production assets (no source maps, no QuickJS) and passes the desktop suite when served by `wrangler pages dev` | PASS |
| 23 | SHA-256 checksums generated and verified (`sha256sum -c SHA256SUMS.txt`) | PASS |

## Deployment (to do by the maintainer; steps in [DEPLOYMENT.md](DEPLOYMENT.md))

| # | Item | Status |
|---|------|--------|
| 24 | Deployed to Cloudflare Pages | BLOCKED: no Cloudflare credentials or network access from the build environment. Nothing was deployed. |
| 25 | Live: deep links return 200, unknown paths return 404, `/merge-pdf/` redirects with 308 | NOT TESTED |
| 26 | Live: all security headers present (`curl -sI`), HSTS over HTTPS | NOT TESTED |
| 27 | Live: `/pdfjs/<version>/wasm/openjpeg.wasm` served as `application/wasm`; cmaps and fonts 200 | NOT TESTED |
| 28 | Cloudflare Web Analytics / "Automatic setup", Rocket Loader and HTML-rewriting features are OFF | NOT TESTED |
| 29 | DevTools → Network during a job on the live site: only same-origin static assets | NOT TESTED |
| 30 | `SITE_URL` set for the production build if a custom domain is used | NOT TESTED |

## Manual browser and device checks

| # | Item | Status |
|---|------|--------|
| 31 | One job per tool in Firefox (desktop), EN and AR | NOT TESTED |
| 32 | One job per tool in Safari (macOS), EN and AR | NOT TESTED |
| 33 | iPhone (Safari): merge, compress, PDF→JPG, Arabic UI | NOT TESTED |
| 34 | Mid-range Android (Chrome): compress a 100 MB scanned PDF; note device and time | NOT TESTED |

## Tagging

| # | Item | Status |
|---|------|--------|
| 35 | Tag `v1.0.0` and publish the GitHub release | NOT DONE (not authorised; do it only after items 17 and 24–34 pass) |
