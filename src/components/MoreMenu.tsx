import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, type IconName } from './Icon'

export interface MoreMenuItem {
  label: string
  icon: IconName
  /** Acción o, si se da `to`, navegar a esa ruta. */
  onClick?: () => void
  to?: string
}

/** Botón "⋯" con acciones secundarias (en el celular, donde no caben como botones). */
export function MoreMenu({
  items,
  className,
  variant = 'secondary',
  disabled,
}: {
  items: MoreMenuItem[]
  className?: string
  /** 'ghost': solo el icono, para renglones de lista. */
  variant?: 'secondary' | 'ghost'
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Más acciones"
        title="Más acciones"
        disabled={disabled}
        className={`btn btn-icon ${variant === 'ghost' ? 'btn-ghost text-ink-muted' : 'btn-secondary'}`}
      >
        <Icon name="more" size={20} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 min-w-56 overflow-hidden border-2 border-line-side bg-surface py-1 shadow-popover">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                if (it.to) navigate(it.to)
                else it.onClick?.()
              }}
              className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left hover:bg-subtle"
            >
              <Icon name={it.icon} className="text-ink-muted" />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
