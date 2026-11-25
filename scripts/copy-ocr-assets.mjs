// Copies the OCR runtime into public/ocr/<tesseract.js version>/ so it is served from our own origin
// (no CDN; CSP: worker-src/script-src/connect-src 'self') and cached as immutable under a versioned path:
// - worker.min.js: tesseract.js's worker, started from this same-origin URL (no blob: workers);
// - core/: the Tesseract engine compiled to WebAssembly, LSTM-only builds (relaxed-SIMD, SIMD and plain;
//   the worker loads the one the browser supports);
// - lang/: English and Arabic "best_int" models (4.0.0_best_int), gzip-compressed.
// Fetched only when someone runs OCR. Licences are copied alongside.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nm = join(root, 'node_modules')
const version = JSON.parse(readFileSync(join(nm, 'tesseract.js', 'package.json'), 'utf8')).version
const base = join(root, 'public', 'ocr')
const dest = join(base, version)
rmSync(base, { recursive: true, force: true })
mkdirSync(join(dest, 'core'), { recursive: true })
mkdirSync(join(dest, 'lang'), { recursive: true })
cpSync(join(nm, 'tesseract.js', 'dist', 'worker.min.js'), join(dest, 'worker.min.js'))
cpSync(join(nm, 'tesseract.js', 'LICENSE.md'), join(dest, 'LICENSE-tesseract.js.md'))
for (const f of ['tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js']) {
  cpSync(join(nm, 'tesseract.js-core', f), join(dest, 'core', f))
}
cpSync(join(nm, 'tesseract.js-core', 'LICENSE'), join(dest, 'core', 'LICENSE'))
for (const lang of ['eng', 'ara']) {
  cpSync(join(nm, '@tesseract.js-data', lang, '4.0.0_best_int', `${lang}.traineddata.gz`), join(dest, 'lang', `${lang}.traineddata.gz`))
}
writeFileSync(join(dest, 'lang', 'NOTICE.txt'), 'English and Arabic Tesseract LSTM models (4.0.0_best_int), Apache License 2.0\n' +
  '(https://github.com/tesseract-ocr/tessdata_best), packaged by @tesseract.js-data (MIT).\n')
console.log(`OCR runtime (tesseract.js ${version}, English + Arabic) copied to public/ocr/${version}`)
