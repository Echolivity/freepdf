# Deploying FreePDF to Cloudflare (free plan)

FreePDF is a static site. All processing happens in the visitor's browser, so there's no server code,
database, KV, R2, D1 or Workers script, and nothing that costs money at normal traffic levels.

| Item | Value |
|------|-------|
| Build command | `npm ci && npm run build` (Node 22.13 or later) |
| Output directory | `dist/` (20 top-level entries, about 7 MB; the largest file is about 1.3 MB, against Cloudflare's 25 MiB limit) |
| Required environment | none |
| Optional build variable | `SITE_URL=https://your.domain`. It adds canonical links, `og:url` and `sitemap.xml`. When unset, these are left out rather than guessed. |
| Runtime services | none (static assets only) |
| Cost | free plan (static requests are free and unlimited) |

## What `dist/` contains

| Path | Purpose |
|------|---------|
| `index.html`, `<tool>.html` (11), `privacy.html` | Prerendered app shell per route, each with its own title, description and Open Graph tags. Deep links work without host-specific single-page-app settings. |
| `404.html` | Not-found page with `noindex`. Cloudflare serves it with status 404 for unknown paths. |
| `assets/` | Hashed JS, CSS and fonts. Cached for a year (`immutable`). |
| `pdfjs/<version>/` | PDF.js CMaps, standard fonts, WASM decoders and ICC profiles. The path is versioned, so they're immutable. The QuickJS document-script sandbox is deliberately excluded. |
| `_headers` | Security and cache headers (see below). |
| `robots.txt`, `sitemap.xml` (sitemap only when `SITE_URL` is set) | Crawling. |
| `theme-init.js`, `favicon.svg` | Applies theme and language before the first paint, and the site icon. |

## Option A: Cloudflare Drop (quickest, no Git)

1. Run `npm ci && npm run build`, or use the provided `freepdf-dist-*.zip`.
2. Open <https://cloudflare.com/drop> and drop the ZIP, or the contents of `dist/`.
3. You get a temporary preview link, valid for 1 hour. Press **Claim** and sign in to keep it.
4. The site is served from `https://<project>.<your-subdomain>.workers.dev`.

## Option B: Cloudflare Pages, direct upload

1. In the Cloudflare dashboard, go to **Workers & Pages → Create**. Choose the Pages option that uploads
   your own assets (Direct Upload) and name the project `freepdf`.
2. Upload the contents of `dist/`.
3. Or from a terminal, with an API token that has *Cloudflare Pages: Edit*:
   ```bash
   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npx wrangler pages deploy dist --project-name=freepdf
   ```

## Option C: GitHub Actions (tests, then deploy)

`.github/workflows/ci.yml` runs on every push and pull request (details in [TESTING.md](TESTING.md)):
1. `checks`: `npm audit --audit-level=high`, typecheck, lint, unit tests, build.
2. `chromium`: the browser suite on emulated Chromium device profiles.
3. `cross-engine`: the browser suite on Firefox, WebKit, iPad and iPhone SE (WebKit) profiles.
4. `cloudflare`: the desktop browser suite and the 30-scenario real-world QA inside Cloudflare's Pages
   runtime (`wrangler pages dev`), with qpdf, pypdf and pyHanko validators.

The deploy job needs all four to pass.

It **deploys only when you allow it**. Configure these in **Settings → Secrets and variables → Actions**:

| Name | Type | Value |
|------|------|-------|
| `DEPLOY_ENABLED` | variable | `true`. Without it, nothing is deployed. |
| `CLOUDFLARE_API_TOKEN` | secret | Token with *Account · Cloudflare Pages · Edit* |
| `CLOUDFLARE_ACCOUNT_ID` | secret | Your account ID |
| `CF_PAGES_PROJECT` | variable (optional) | Defaults to `freepdf` |
| `SITE_URL` | variable (optional) | `https://your.domain` |

Pushes to `main` deploy production. Pull requests from the same repository get preview URLs.

## Custom domain and HTTPS

1. Open the Pages project, go to **Custom domains → Set up a domain**, and enter e.g. `pdf.example.com`.
2. If the domain's DNS is on Cloudflare, the record is created automatically. Otherwise, add the CNAME the
   dashboard shows.
3. Cloudflare issues the certificate automatically, at no cost.
4. Rebuild with `SITE_URL=https://pdf.example.com` so canonical links and the sitemap use the real domain.
5. `Strict-Transport-Security: max-age=31536000` is sent from `_headers`. Browsers honour it only over
   HTTPS. Add `includeSubDomains; preload` only if **every** subdomain of the zone is HTTPS-only.

## Settings that must stay off

- **Cloudflare Web Analytics / "Automatic setup":** it injects a third-party beacon script. That
  contradicts the privacy policy, and the CSP would block it anyway.
- **Rocket Loader, HTML minification, Email obfuscation, Mirage or other "Auto Optimize" features**
  that rewrite HTML or inject scripts. They can conflict with the strict CSP. Static asset caching is fine.
- **Pages Functions:** none are needed, so don't add a `functions/` directory.

## Validating a deployment

Run this locally against Cloudflare's own runtime (workerd) before uploading:

```bash
npm run build
npm run test:cloudflare   # full desktop browser suite against `wrangler pages dev dist`
npm run qa:cloudflare     # real-world QA (large/protected/signed/Arabic/corrupted files) against the same runtime
```

After deploying, on the live URL:

```bash
curl -sI https://<site>/merge-pdf | grep -iE 'content-security|strict-transport|x-content|referrer|cross-origin|permissions'
curl -s -o /dev/null -w '%{http_code}\n' https://<site>/merge-pdf     # 200
curl -s -o /dev/null -w '%{http_code}\n' https://<site>/does-not-exist # 404 (custom page)
curl -sI https://<site>/merge-pdf/ | grep -i location                   # 308 → /merge-pdf
```

Then follow [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md): manual browser and device checks, and
confirming Web Analytics is off.

## Verified behaviour (Cloudflare Pages runtime, `wrangler pages dev` 4.160, 1.0.0 build)

| Check | Result |
|-------|--------|
| `/`, `/merge-pdf`, `/privacy` | 200 `text/html; charset=utf-8`, with per-route `<title>` |
| `/merge-pdf/` and `/merge-pdf.html` | 308 redirect to `/merge-pdf` |
| Unknown path | 404 with the custom 404 page and `noindex` (automated in `security.spec.ts`) |
| JS (`.js`, `.mjs`) | `application/javascript`. WASM: `application/wasm`. Fonts: correct font types. |
| `/assets/*`, `/pdfjs/<version>/*` | `Cache-Control: public, max-age=31536000, immutable` |
| HTML | `Cache-Control: public, max-age=0, must-revalidate` (Cloudflare default) |
| Security headers | CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COOP, CORP and X-Frame-Options all present |
| Browser suite (Chromium desktop) | 72/72 passed inside the runtime |
| Real-world QA | 30/30 scenarios passed inside the runtime (strict validators) |
| WebKit engine (WebKitGTK 2.52) | 10/10 inside the runtime served over HTTPS (`--local-protocol https`) with the unmodified production CSP |

The live Cloudflare edge was not reachable from the build environment, and no deployment of 1.0.0 was
made from it. **Run the post-deploy checks above on the real URL.**

## Publishing 1.0.0 (manual steps)

Nothing below has been done on your behalf.

1. **Verify the archives** you received:
   ```bash
   sha256sum -c SHA256SUMS.txt
   ```
2. **Put the source in Git** (if the repository isn't on GitHub yet):
   ```bash
   unzip freepdf-1.0.0-source.zip && cd freepdf-1.0.0
   git init -b main && git add -A && git commit -m "FreePDF 1.0.0"
   git remote add origin git@github.com:<you>/freepdf.git && git push -u origin main
   ```
   Then let CI run **without** `DEPLOY_ENABLED`, and confirm all four test jobs are green, including
   `cross-engine` (Firefox/WebKit), which has not been executed anywhere else for 1.0.0.
3. **Deploy**, choosing one route:
   - *CI:* set the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets and the `DEPLOY_ENABLED=true`
     variable, then re-run the workflow on `main`.
   - *Terminal:* `npm ci && npm run build`, then
     `CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npx wrangler pages deploy dist --project-name=freepdf --branch=main`.
   - *Dashboard / Drop:* upload the contents of `freepdf-1.0.0-dist.zip` (it unpacks to the site root:
     `index.html`, `_headers`, `assets/`, `pdfjs/` …).
4. **Verify the live site** with the `curl` commands above, then work through the "On the deployment"
   and "After promoting to production" sections of [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).
5. **Tag only after steps 2–4 pass:**
   ```bash
   git tag -a v1.0.0 -m "FreePDF 1.0.0" && git push origin v1.0.0
   ```
   Create the GitHub release from `docs/RELEASE_NOTES_v1.0.0.md` and attach the two ZIPs and `SHA256SUMS.txt`.
