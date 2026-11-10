import type { SVGProps } from 'react'

/** One consistent 24px, 1.75-stroke icon set drawn for FreePDF. */
const paths = {
  merge: <><path d="M5 4h6l3 3v4" /><path d="M5 4v12h4" /><path d="M13 13h6v7h-8v-5" /><path d="M9 16l2-2 2 2" /></>,
  split: <><path d="M6 3h8l4 4v4" /><path d="M6 3v8" /><path d="M3 14h18" strokeDasharray="2.5 2.5" /><path d="M6 17v4h12v-4" /></>,
  extract: <><path d="M5 3h9l5 5v13H5z" /><path d="M14 3v5h5" /><path d="M12 11v7" /><path d="M9 15l3 3 3-3" /></>,
  remove: <><path d="M5 3h9l5 5v13H5z" /><path d="M14 3v5h5" /><path d="M9.5 12.5l5 5M14.5 12.5l-5 5" /></>,
  organize: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.2" /></>,
  rotate: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
  rotateLeft: <><path d="M4 11a8 8 0 1 1 2.3 5.7" /><path d="M4 4v7h7" /></>,
  compress: <><path d="M5 3h9l5 5v13H5z" /><path d="M14 3v5h5" /><path d="M12 9.5v3M9.5 10l2.5 2.5L14.5 10M12 18.5v-3M9.5 18l2.5-2.5 2.5 2.5" /></>,
  imageOut: <><path d="M4 3h8l4 4v4" /><path d="M4 3v18h6" /><rect x="12.5" y="13" width="8.5" height="8" rx="1.2" /><path d="M13 20l2.6-2.8 1.8 1.8 1.2-1.2 2 2" /></>,
  imageIn: <><rect x="3" y="3" width="9" height="8" rx="1.2" /><path d="M3.5 10l2.8-3 2 2 1.2-1.2 2.2 2.2" /><path d="M14 6h3l4 4v11H9v-6" /><path d="M17 6v4h4" /></>,
  upload: <><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
  download: <><path d="M12 4v12" /><path d="M7 11l5 5 5-5" /><path d="M4 20h16" /></>,
  x: <><path d="M6 6l12 12M18 6L6 18" /></>,
  check: <><path d="M5 12.5l4.5 4.5L19 7.5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  shield: <><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z" /><path d="M8.8 12.2l2.2 2.2 4.3-4.6" /></>,
  arrowLeft: <><path d="M19 12H5M11 6l-6 6 6 6" /></>,
  arrowUp: <><path d="M12 19V5M6 11l6-6 6 6" /></>,
  arrowDown: <><path d="M12 5v14M6 13l6 6 6-6" /></>,
  grip: <><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></>,
  zip: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="M10 6h1M10 9h1M10 12h1M9.5 15h2v3h-2z" /></>,
  alert: <><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.2v.3" /></>,
  refresh: <><path d="M20 12a8 8 0 0 1-14.3 4.9M4 12A8 8 0 0 1 18.3 7.1" /><path d="M18.5 3v4.5H14M5.5 21v-4.5H10" /></>,
  cpu: <><rect x="6" y="6" width="12" height="12" rx="1.5" /><path d="M9.5 9.5h5v5h-5zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" /></>,
  github: <><path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" /></>,
} as const

export type IconName = keyof typeof paths

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {paths[name]}
    </svg>
  )
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M10 7h9l5 5v13a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" fill="var(--paper)" />
      <path d="M19 7v5h5" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12.5 19.5l2.6 2.6 5-5.6" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
