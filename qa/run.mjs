// Runs the real-world QA suite, always writes docs/QA_REPORT.md, and exits non-zero if Playwright
// failed OR any recorded scenario is not PASS. (Previously `playwright …; node report` swallowed failures.)
// Usage: node qa/run.mjs            → against `npm run preview`
//        node qa/run.mjs --cloudflare → against Cloudflare's local Pages runtime (wrangler pages dev)
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'

const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1

if (run('python3', ['qa/make-qa-inputs.py']) !== 0) process.exit(1)
rmSync('qa/results/raw.jsonl', { force: true })
const tests = process.argv.includes('--cloudflare')
  ? run('node', ['scripts/test-cloudflare.mjs', '--config', 'qa/playwright.qa.config.ts'])
  : run('npx', ['playwright', 'test', '-c', 'qa/playwright.qa.config.ts'])
const report = run('node', ['qa/report.mjs', '--strict'])
if (tests !== 0) console.error(`QA: Playwright exited with ${tests}`)
process.exit(tests || report)
