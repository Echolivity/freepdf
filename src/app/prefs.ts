import { RENAMED } from '../tools/registry'
import { useCallback, useEffect, useState } from 'react'

/**
 * The only things FreePDF ever stores: theme choice and recently used tool slugs.
 * Never file names or contents.
 */
const THEME_KEY = 'freepdf:theme'
const RECENT_KEY = 'freepdf:recent'

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* storage disabled: fine */ }
}

export type Theme = 'light' | 'dark'

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark'
      write(THEME_KEY, next)
      return next
    })
  }, [])
  return [theme, toggle]
}

export function getRecentTools(): string[] {
  try {
    const v = JSON.parse(read(RECENT_KEY) ?? '[]')
    if (!Array.isArray(v)) return []
    // Tools that moved to a new address are listed under it.
    const slugs = v.filter((s): s is string => typeof s === 'string').map((s) => RENAMED[s] ?? s)
    return [...new Set(slugs)].slice(0, 6)
  } catch {
    return []
  }
}

export function recordRecentTool(slug: string) {
  const next = [slug, ...getRecentTools().filter((s) => s !== slug)].slice(0, 6)
  write(RECENT_KEY, JSON.stringify(next))
}

/** Every key FreePDF writes. Keep in sync with the privacy page and tests/e2e/fixtures.ts. */
export const STORAGE_KEYS = ['freepdf:theme', 'freepdf:lang', 'freepdf:recent'] as const

export function clearAllSettings() {
  for (const k of STORAGE_KEYS) {
    try { localStorage.removeItem(k) } catch { /* ignore */ }
  }
}

export function clearRecentTools() {
  try { localStorage.removeItem(RECENT_KEY) } catch { /* ignore */ }
}
