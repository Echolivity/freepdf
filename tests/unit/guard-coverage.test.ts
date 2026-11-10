import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Every browser spec must use the guarded `test` from fixtures.ts, so the privacy guard can't be bypassed. */
describe('privacy guard coverage', () => {
  const dir = join(__dirname, '..', 'e2e')
  const specs = readdirSync(dir).filter((f) => f.endsWith('.spec.ts'))
  it('finds the browser specs', () => expect(specs.length).toBeGreaterThan(3))
  for (const f of specs) {
    it(`${f} imports test from ./fixtures, never directly from @playwright/test`, () => {
      const src = readFileSync(join(dir, f), 'utf8')
      expect(src).not.toMatch(/from '@playwright\/test'/)
      expect(src).toMatch(/import \{[^}]*\btest\b[^}]*\} from '\.\/fixtures'/)
    })
  }
})
