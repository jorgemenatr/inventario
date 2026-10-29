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
      className={`seg ${size === 'lg' ? 'h-12' : ''}`}
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
          className={`seg-option ${size === 'lg' ? 'px-4 text-[15px]' : ''}`}
        >
          {o.icon && <Icon name={o.icon} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}
