# Release checklist — 1.1.0

Status key: **PASS** = executed with evidence · **FAIL** · **BLOCKED** = couldn't be executed in the
release environment (reason given) · **NOT TESTED** = needs hardware, accounts or a person.
Evidence is in [TEST_AND_QA_REPORT.md](TEST_AND_QA_REPORT.md). Run date: 2026-11-11.

## Source and build

| # | Item | Status |
|---|------|--------|
| 1 | `package.json` and `package-lock.json` both at 1.1.0; `npm ci` in a fresh clone succeeds and leaves the tree unchanged | PASS |
| 2 | No new runtime or dev dependencies; `npm audit`: 0 vulnerabilities | PASS |
| 3 | No archives, secrets, personal data or machine-specific paths in tracked files | PASS |
| 4 | Typecheck and lint: 0 errors, 0 warnings | PASS |
| 5 | Production build; homepage JS 99.6 KB gzipped; new tool UIs load without pdf-lib | PASS |

## New features

| # | Item | Status |
|---|------|--------|
| 6 | Resize PDF: all sizes and modes, selected pages, preview, EN/AR | PASS |
| 7 | Resize keeps text, fields, bookmarks and annotations; vector, not raster; original bytes when unchanged | PASS |
| 8 | Compare PDF: text diff with highlights, overlay, visual check, PDF report, EN/AR | PASS |
| 9 | Compare is read-only and local (privacy guard on every test) | PASS |
| 10 | Generated PDFs inspected (qpdf, pypdf strict, rendered and viewed) | PASS |

## Automated tests

| # | Item | Status |
|---|------|--------|
| 11 | Unit/integration, `CI=1`: 135 / 135 | PASS |
| 12 | Browser, 5 Chromium profiles, `CI=1`: 192 passed, 1 Cloudflare-only skip | PASS |
| 13 | Browser inside the Cloudflare runtime: 80 / 80 | PASS |
| 14 | Real-world QA inside the Cloudflare runtime, strict: 35 / 35 | PASS |
| 15 | Accessibility (axe WCAG 2.1 AA) including the Resize and Compare screens | PASS (Chromium) |
| 16 | WebKit engine (WebKitGTK 2.52): 12 / 12 including Resize and Compare | PASS |
| 17 | Playwright Firefox, WebKit, iPad, iPhone SE projects | BLOCKED: downloads refused by the sandbox. **Must be green in CI (`cross-engine`) before tagging.** |

## Release package

| # | Item | Status |
|---|------|--------|
| 18 | Source ZIP from `git archive`: unpacks, `npm ci`, unit tests and build pass | PASS |
| 19 | Dist ZIP: production assets only; passes the desktop suite under `wrangler pages dev` | PASS |
| 20 | SHA-256 checksums generated and verified | PASS |

## Deployment and manual checks (maintainer; steps in [DEPLOYMENT.md](DEPLOYMENT.md))

| # | Item | Status |
|---|------|--------|
| 21 | Deployed to Cloudflare | BLOCKED: no credentials or network access from the build environment. Nothing was deployed. |
| 22 | Live: `/resize-pdf` and `/compare-pdf` return 200; headers present; other post-deploy checks | NOT TESTED |
| 23 | Resize and Compare in Firefox and Safari (desktop), EN and AR | NOT TESTED |
| 24 | Resize and Compare on a real phone (iPhone and mid-range Android) | NOT TESTED |
| 25 | Tag `v1.1.0` and publish the release | NOT DONE (not authorised; only after items 17 and 21–24) |
