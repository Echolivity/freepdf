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

// Font embedded into PDFs when text needs more than the standard 14 fonts (Arabic, Arabic-Indic
// digits, other non-Latin text): IBM Plex Sans Arabic (SIL OFL 1.1), which covers Arabic and Latin.
// Fetched by the worker from our own origin, only when such text is drawn.
const fontPkg = join(root, 'node_modules', '@expo-google-fonts', 'ibm-plex-sans-arabic')
// Versioned path, so the immutable cache rule for /pdfjs/* is safe (FONT_VERSION in src/lib/pdf/fonts.ts).
const fontVersion = JSON.parse(readFileSync(join(fontPkg, 'package.json'), 'utf8')).version
const fontDest = join(base, 'fonts', fontVersion)
mkdirSync(fontDest, { recursive: true })
cpSync(join(fontPkg, '400Regular', 'IBMPlexSansArabic_400Regular.ttf'), join(fontDest, 'IBMPlexSansArabic-Regular.ttf'))
cpSync(join(fontPkg, '700Bold', 'IBMPlexSansArabic_700Bold.ttf'), join(fontDest, 'IBMPlexSansArabic-Bold.ttf'))
cpSync(join(fontPkg, 'LICENSE_FONT'), join(fontDest, 'OFL.txt'))
console.log(`IBM Plex Sans Arabic copied to public/pdfjs/fonts/${fontVersion} (OFL 1.1)`)
