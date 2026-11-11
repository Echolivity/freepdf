import { Icon } from './Icon'
import { CAT_VAR, type ToolDef } from '../tools/registry'

/** A page-shaped tile with a folded corner, tinted with the tool's category colour. */
export function ToolGlyph({ tool, size = 'md' }: { tool: ToolDef; size?: 'md' | 'lg' }) {
  const color = CAT_VAR[tool.category]
  return (
    <span aria-hidden="true" className={`relative grid shrink-0 place-items-center ${size === 'lg' ? 'h-16 w-[54px]' : 'h-[52px] w-11'}`} style={{ color }}>
      <svg viewBox="0 0 44 52" className="absolute inset-0 h-full w-full overflow-visible rtl:-scale-x-100">
        <path
          d="M8 .75h23.5L43.25 12.5V43.25a8 8 0 0 1-8 8H8.75a8 8 0 0 1-8-8V8.75a8 8 0 0 1 7.25-8z"
          fill={`color-mix(in srgb, ${color} 12%, var(--surface))`}
          stroke={`color-mix(in srgb, ${color} 30%, transparent)`}
          strokeWidth="1.25"
        />
        <path d="M31.5.75V8.5a4 4 0 0 0 4 4h7.75" fill={`color-mix(in srgb, ${color} 26%, var(--surface))`} stroke={`color-mix(in srgb, ${color} 30%, transparent)`} strokeWidth="1.25" strokeLinejoin="round" />
      </svg>
      <Icon name={tool.icon} size={size === 'lg' ? 28 : 23} className="relative mt-1.5" />
    </span>
  )
}
