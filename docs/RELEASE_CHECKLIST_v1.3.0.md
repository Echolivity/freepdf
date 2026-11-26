# Release checklist — 1.3.0 (draft)

Status key: **PASS** = executed with evidence · **FAIL** · **OPEN** = still to do ·
**BLOCKED** = can't be done from the build environment (reason given) · **NOT TESTED** = needs
hardware, accounts or a person. Nothing here has been tagged, published or deployed.

## Source and build

| # | Item | Status |
|---|------|--------|
| 1 | `package.json` and `package-lock.json` bumped to 1.3.0; `npm ci` in a fresh clone leaves the tree unchanged | OPEN (version still 1.2.0) |
| 2 | New runtime dependencies pinned, licensed and loaded only where needed: `docx-preview` 0.4.1, `utif2` 4.1.0, `tesseract.js` 7.0.0 | PASS |
| 3 | `npm audit` 0 vulnerabilities, no open exceptions in `scripts/audit.mjs` | PASS |
| 4 | No archives, secrets, personal data or machine paths in tracked files; all fixtures synthetic | PASS |
| 5 | Typecheck and lint: 0 errors, 0 warnings | PASS |
| 6 | Page weight: tool page 205 KB gzipped before a file is chosen (was 377 KB); PDF.js loads on first open | PASS |
| 7 | CHANGELOG sections merged into one `1.3.0 — <date>` entry | OPEN |

## Features (automated evidence in the test suites)

| # | Item | Status |
|---|------|--------|
| 8 | Conversion tools (11), each with browser tests on its main paths | PASS |
| 9 | Bank statement to Excel: EN/AR, signed amounts, newest-first, scanned; Excel/CSV/OFX | PASS |
| 10 | OCR: EN/AR scans to searchable PDF and text; converters read scans | PASS |
| 11 | Fill & Sign: fill (EN/AR), lock, text/date/tick/cross, drawn/typed signature, initials on every page | PASS |
| 12 | Redact: search and patterns, hand-drawn and whole-page boxes; no redacted string anywhere in the output (streams decompressed), including metadata, bookmarks, form values, structure tree and shared resources | PASS |

## Automated tests

| # | Item | Status |
|---|------|--------|
| 13 | Unit/integration: 245 / 245 | PASS |
| 14 | Browser, 5 Chromium profiles: 254 passed, 1 Cloudflare-only skip | PASS |
| 15 | Accessibility (axe WCAG 2.1 AA) on every new screen, EN/AR, light/dark | PASS (Chromium) |
| 16 | CI on the release commit: checks, Chromium, cross-engine (Firefox), Cloudflare runtime | OPEN (green on every commit so far; re-check on the release commit) |
| 17 | Firefox accessibility: all rules on every screen except the one right after a download (probe in PR #12) | PASS (pending CI on the commit) |

## Deployment and manual checks (maintainer; steps in [DEPLOYMENT.md](DEPLOYMENT.md))

| # | Item | Status |
|---|------|--------|
| 18 | Cloudflare secrets set (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) and `DEPLOY_ENABLED=true` | OPEN (maintainer) |
| 19 | Deployed; live routes for the 16 new tools return 200; `/ocr/7.0.0/` and `/pdfjs/` assets served with immutable caching; CSP and other headers present | NOT TESTED |
| 20 | New tools in Firefox and Safari (desktop), EN and AR | NOT TESTED |
| 21 | Fill & Sign drawing and Redact box drawing on a real iPhone and a real Android phone | NOT TESTED |
| 22 | Output opened in Microsoft Word/Excel/PowerPoint and Adobe Acrobat (filled and redacted PDFs) | NOT TESTED |
| 23 | Tag `v1.3.0` and publish | NOT DONE (not authorised; only after items 1, 7, 16 and 18–22) |
