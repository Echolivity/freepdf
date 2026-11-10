import { useEffect } from 'react'

/** Keep <title> and the description meta in sync on client-side navigation (static HTML has them too). */
export function useSeo(title: string, description: string) {
  useEffect(() => {
    document.title = title
    document.querySelector('meta[name="description"]')?.setAttribute('content', description)
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', title)
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', description)
  }, [title, description])
}
