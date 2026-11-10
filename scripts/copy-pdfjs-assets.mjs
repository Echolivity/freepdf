// Copies PDF.js runtime assets (CMaps, standard fonts, WASM decoders, ICC profiles) into
// public/pdfjs/<pdfjs-version>/ so they are served from our own origin (no CDN, strict CSP) and can be
// cached as immutable: a new PDF.js version gets a new path.
// Deliberately NOT copied: the QuickJS sandbox (quickjs-eval.*). It only exists to run JavaScript
// embedded in PDFs; FreePDF never executes document scripts, so it isn't shipped at all.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'pdfjs-dist')
const { version } = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'))
const base = join(root, 'public', 'pdfjs')
const dest = join(base, version)
rmSync(base, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const from = join(src, dir)
  if (existsSync(from)) cpSync(from, join(dest, dir), { recursive: true, filter: (p) => !/quickjs/i.test(p) })
}
console.log(`pdf.js ${version} assets copied to public/pdfjs/${version} (QuickJS excluded)`)
