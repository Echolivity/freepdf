# FreePDF 1.0.0

Private PDF tools that run entirely in your browser: no uploads, no account, no subscription, no
quotas, no watermark, no ads, no tracking. English and Arabic (right-to-left).

This release adds no features and changes no app behaviour compared with 1.0.0-rc.1. It is the release-
hardening pass: the build, CI and test pipeline were audited, failures that could slip through were
closed, and new security and privacy tests were added.

## Tools

Merge, Split, Extract pages, Remove pages, Organize, Rotate, Compress (Lossless, Light, Balanced,
Strong), PDF → JPG, PDF → PNG, JPG/PNG/WebP → PDF.

## Changes since 1.0.0-rc.1

**Release and CI integrity**
- CI is split into `checks`, `chromium`, `cross-engine` (Firefox/WebKit), and `cloudflare` (desktop
  suite and the 30-scenario real-world QA inside Cloudflare's Pages runtime). Each suite runs once.
  Deploy needs all four and the `DEPLOY_ENABLED` opt-in.
- The real-world QA now fails the build when a scenario fails. Before, the script printed the report
  and exited successfully.
- PDF validators (qpdf, pyHanko) are mandatory in CI. Before, a missing validator was silently skipped.
- In CI, a test that only passes on retry fails the run.
- `package-lock.json` is in sync with `package.json`. An obsolete nested archive
  (`freepdf-phase1.zip`) was removed from the source, and archives are git-ignored.

**New tests**
- A PDF carrying JavaScript in every common trigger (open action, document scripts, page action,
  link) is rendered and processed without any of it running.
- The privacy guard now also fails on file names or document content in the console, from pages and
  workers alike.
- All 13 pages are crawled in English and Arabic, checking for console errors and failed assets.
  Unknown paths return a real 404 with `noindex` on Cloudflare.
- A WebKit engine smoke suite over WebDriver (`qa/webkitgtk-smoke.mjs`) for machines where Playwright's
  WebKit can't be installed.

**Documentation**
- TESTING, SECURITY, PRIVACY, DEPLOYMENT, the release checklist and the test report match what CI
  actually runs. The rc.1 release notes carry a correction about CI.
- PRIVACY now states that output files can keep scripts present in the input. FreePDF never runs them.

## Test results

| Suite | Result |
|-------|--------|
| Unit / integration | 110 / 110 |
| Browser, 5 Chromium device profiles | 180 passed, 1 skipped (Cloudflare-only test) |
| Browser, inside Cloudflare's Pages runtime | 72 / 72 |
| Real-world QA inside the Cloudflare runtime (strict validators) | 30 / 30 |
| WebKit engine (WebKitGTK 2.52) inside the Cloudflare runtime, HTTPS, production CSP | 10 / 10 |
| `npm audit` | 0 vulnerabilities |
| Playwright Firefox / WebKit projects | **Not executed here**; they run in CI's `cross-engine` job |
| Safari, physical phones and tablets | **Not tested** |

Details: [TEST_AND_QA_REPORT.md](TEST_AND_QA_REPORT.md).

## Before tagging v1.0.0

These items couldn't be done from the build environment:
1. CI is green on the repository, **including the `cross-engine` job**.
2. The site is deployed, and the post-deploy checks pass on the live URL.
3. The manual browser and device checks in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) are done.

## Known limitations

- **Merge** doesn't combine bookmarks, fillable form fields or attachments.
- **Large splits:** splits into more than 40 parts keep page content only.
- **Signed PDFs:** any real change invalidates a digital signature. FreePDF warns first, and it can't
  re-sign.
- **Compression:** helps photos and scans. Text-only, CMYK and transparent content barely change; the
  report says so per file.
- **Password-protected PDFs** open only in PDF → JPG/PNG.
- **Memory:** the browser's memory is the real ceiling. On phones, files near the 100 MB limit may
  fail; the app reports this and recovers.
- **Embedded scripts:** output files can keep the input's embedded scripts (FreePDF never runs them).
- **Signature detection:** signature dictionaries inside compressed object streams aren't detected
  (rare).
- **pdf-lib:** version 1.17.1 is unmaintained (no known vulnerabilities).
