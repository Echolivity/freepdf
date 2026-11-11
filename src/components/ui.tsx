import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { useI18n } from '../i18n/context'
import type { Message } from '../i18n/core'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'secondary',
  icon,
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: IconName; size?: 'sm' | 'md' | 'lg' }) {
  const v = {
    primary: 'bg-accent text-on-accent shadow-glow hover:bg-accent-hover disabled:bg-surface-2 disabled:text-muted disabled:shadow-none disabled:ring-1 disabled:ring-inset disabled:ring-line-strong',
    secondary: 'border border-line-strong bg-surface text-ink shadow-card hover:border-ink/35 hover:bg-surface-2 disabled:opacity-50',
    ghost: 'text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50',
    danger: 'text-danger hover:bg-danger-soft disabled:opacity-50',
  }[variant]
  const s = { sm: 'h-9 px-3 text-sm gap-1.5 rounded-lg', md: 'h-11 px-4 text-[15px] gap-2 rounded-xl', lg: 'h-14 px-6 text-[17px] gap-2.5 rounded-2xl' }[size]
  return (
    <button type="button" className={`inline-flex items-center justify-center font-semibold transition-[background-color,border-color,color,box-shadow] disabled:cursor-not-allowed ${v} ${s} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'lg' ? 22 : 18} />}
      {children}
    </button>
  )
}

export function Notice({ tone = 'info', children, onDismiss }: { tone?: 'info' | 'error' | 'ok'; children: ReactNode; onDismiss?: () => void }) {
  const { t } = useI18n()
  const cls = {
    info: 'border-line bg-surface text-ink',
    error: 'border-danger/30 bg-danger-soft text-ink',
    ok: 'border-ok/30 bg-ok-soft text-ink',
  }[tone]
  const icon: IconName = tone === 'error' ? 'alert' : tone === 'ok' ? 'check' : 'shield'
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`fade-in flex items-start gap-3 rounded-xl border px-4 py-3 ${cls}`}>
      <Icon name={icon} size={20} className={`mt-0.5 shrink-0 ${tone === 'error' ? 'text-danger' : tone === 'ok' ? 'text-ok' : 'text-accent'}`} />
      <div className="min-w-0 flex-1 text-[15px]">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="-m-1 rounded-md p-1 text-muted hover:text-ink" aria-label={t('common.dismiss')}>
          <Icon name="x" size={18} />
        </button>
      )}
    </div>
  )
}

export function Rejections({ items, onDismiss }: { items: Message[]; onDismiss: () => void }) {
  const { tm } = useI18n()
  if (!items.length) return null
  return (
    <Notice tone="error" onDismiss={onDismiss}>
      {items.length === 1 ? tm(items[0]) : (
        <ul className="list-disc space-y-1 ps-4">{items.map((r, i) => <li key={i}>{tm(r)}</li>)}</ul>
      )}
    </Notice>
  )
}

/** Accessible segmented radio group. */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string
  value: T
  options: { value: T; label: string; hint?: string }[]
  onChange: (v: T) => void
  hint?: ReactNode
}) {
  const name = useId()
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{label}</legend>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length === 4 ? 2 : Math.min(options.length, 3)}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <label
            key={String(o.value)}
            className={`flex min-h-11 cursor-pointer flex-col justify-center rounded-xl border px-3 py-2.5 text-[15px] leading-snug transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
              o.value === value ? 'border-accent bg-accent-soft font-semibold text-ink ring-1 ring-accent' : 'border-line bg-paper hover:border-line-strong'
            }`}
          >
            <input type="radio" name={name} className="sr-only" checked={o.value === value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
            {o.hint && <span className="text-xs font-normal text-muted">{o.hint}</span>}
          </label>
        ))}
      </div>
      {hint && <p className="mt-2 text-sm text-muted">{hint}</p>}
    </fieldset>
  )
}

/** Options panel + primary action, shown beside (desktop) or below (mobile) the workspace. */
export function Workspace({ main, side }: { main: ReactNode; side: ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="min-w-0">{main}</div>
      <aside className="rounded-2xl border border-line bg-surface p-5 shadow-lift lg:sticky lg:top-24" aria-label={t('common.options')}>
        <div className="space-y-5">{side}</div>
      </aside>
    </div>
  )
}

export function LocalBadge() {
  const { t } = useI18n()
  return (
    <p className="flex items-center gap-2 text-sm text-muted">
      <Icon name="shield" size={16} className="shrink-0 text-ok" />
      {t('common.local')}
    </p>
  )
}
