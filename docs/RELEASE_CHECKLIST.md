# Release checklist — 1.2.0

Status key: **PASS** = executed with evidence · **FAIL** · **BLOCKED** = couldn't be executed in the
release environment (reason given) · **NOT TESTED** = needs hardware, accounts or a person.
Evidence is in [TEST_AND_QA_REPORT.md](TEST_AND_QA_REPORT.md). Run date: 2026-11-11.

## Source and build

| # | Item | Status |
|---|------|--------|
| 1 | `package.json` and `package-lock.json` at 1.2.0; `npm ci` in a fresh clone succeeds and leaves the tree unchanged | PASS |
| 2 | New dependencies pinned and justified: `@pdf-lib/fontkit` 1.1.1 (MIT, worker-only); `@expo-google-fonts/ibm-plex-sans-arabic` 0.4.2 (dev, OFL font source); `npm audit` 0 | PASS |
| 3 | No archives, secrets, personal data or machine paths in tracked files | PASS |
| 4 | Typecheck and lint: 0 errors, 0 warnings | PASS |
| 5 | Build; homepage JS 103.0 KB gzipped; fontkit is not part of any page load | PASS |

## Phase 1 features

| # | Item | Status |
|---|------|--------|
| 6 | Crop PDF: visual drag, numeric margins, all/selected/each page, preview; states that content is hidden, not deleted | PASS |
| 7 | Extract PDF pages: pages, ranges, odd/even, one PDF, separate PDFs, every page | PASS |
| 8 | Delete PDF pages: thumbnails, multi-select, ranges, undo/redo, preview, order preserved | PASS |
| 9 | Organize PDF: drag (incl. touch), rotate, delete, duplicate, insert from another PDF, extract selected, undo/redo, preview | PASS |
| 10 | Add page numbers: header/footer, alignment, start, prefix/suffix, font/size/colour, selected pages, skip cover, Roman and Arabic-Indic, preview | PASS |
| 11 | Watermark PDF: text and image, position and rotation, opacity, font and size, tiled, selected pages, preview, quality preserved | PASS |
| 12 | Old addresses redirect (301 on Cloudflare; in-app redirect; recent tools migrated) | PASS |
| 13 | Home: categories with filter chips; empty categories hidden | PASS |
| 14 | Generated PDFs inspected (qpdf, pypdf strict, rendered and viewed) | PASS |

## Automated tests

| # | Item | Status |
|---|------|--------|
| 15 | Unit/integration, `CI=1`: 158 / 158 | PASS |
| 16 | Browser, 5 Chromium profiles, `CI=1`: 209 passed, 1 Cloudflare-only skip | PASS |
| 17 | Browser inside the Cloudflare runtime: 93 / 93 | PASS |
| 18 | Real-world QA inside the Cloudflare runtime, strict: 41 / 41 | PASS |
| 19 | Accessibility (axe WCAG 2.1 AA) on the new screens, EN/AR, light/dark | PASS (Chromium) |
| 20 | Privacy guard on every test; the only new request (same-origin font GET) explicitly allowed | PASS |
| 21 | WebKit engine (WebKitGTK 2.52): 14 / 14 | PASS |
| 22 | Playwright Firefox, WebKit, iPad, iPhone SE projects | BLOCKED: browser downloads refused by the sandbox. **Must be green in CI (`cross-engine`) before tagging.** |

## Release package

| # | Item | Status |
|---|------|--------|
| 23 | Source ZIP from `git archive`: unpacks; `npm ci`, unit tests and build pass | PASS |
| 24 | Dist ZIP: production assets only; passes the desktop suite and WebKitGTK under `wrangler pages dev` | PASS |
| 25 | SHA-256 checksums generated and verified | PASS |

## Deployment and manual checks (maintainer; steps in [DEPLOYMENT.md](DEPLOYMENT.md))

| # | Item | Status |
|---|------|--------|
| 26 | Deployed to Cloudflare | BLOCKED: no credentials or network access from the build environment. Nothing was deployed. |
| 27 | Live: new routes 200; `/extract-pages` and `/remove-pages` 301; headers present; font served from `/pdfjs/fonts/0.4.2/` | NOT TESTED |
| 28 | New tools in Firefox and Safari (desktop), EN and AR | NOT TESTED |
| 29 | Organize drag and Crop handles on a real iPhone and a real Android phone | NOT TESTED |
| 30 | Tag `v1.2.0` and publish | NOT DONE (not authorised; only after items 22 and 26–29) |
