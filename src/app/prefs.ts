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
    return Array.isArray(v) ? v.filter((s) => typeof s === 'string').slice(0, 6) : []
  } catch {
    return []
  }
}

export function recordRecentTool(slug: string) {
  const next = [slug, ...getRecentTools().filter((s) => s !== slug)].slice(0, 6)
  write(RECENT_KEY, JSON.stringify(next))
}

export function clearRecentTools() {
  try { localStorage.removeItem(RECENT_KEY) } catch { /* ignore */ }
}
