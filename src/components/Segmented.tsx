import { Icon, type IconName } from './Icon'

interface Option<T extends string> {
  value: T
  label: string
  icon?: IconName
}

interface Props<T extends string> {
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
  label: string
  size?: 'md' | 'lg'
  disabled?: boolean
}

/** Control de segmentos (mismo estilo que Vista y Modo). */
export function Segmented<T extends string>({ value, options, onChange, label, size = 'md', disabled }: Props<T>) {
  return (
    <div
      className={`flex gap-0.5 rounded-md border border-control bg-surface p-0.5 ${size === 'lg' ? 'h-11' : 'h-control-md'}`}
      role="group"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`flex cursor-pointer items-center gap-1.5 rounded-[6px] px-3 disabled:cursor-not-allowed disabled:opacity-60 ${size === 'lg' ? 'text-heading' : 'text-label'} ${
            value === o.value ? 'bg-brand-soft text-brand-ink' : 'text-ink-muted hover:bg-subtle'
          }`}
        >
          {o.icon && <Icon name={o.icon} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}
