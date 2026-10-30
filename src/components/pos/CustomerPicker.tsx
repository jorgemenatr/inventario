import { useMemo, useState, type KeyboardEvent } from 'react'
import { findByCode } from '../../lib/customers'
import type { Customer } from '../../lib/types'
import { GameTags } from '../GamesInput'
import { Icon } from '../Icon'

interface Props {
  customers: Customer[]
  onPick: (c: Customer) => void
  /** Abre el alta de cliente con lo que se escribió como nombre. */
  /** Sin onCreate no se muestra el botón "Nuevo cliente". */
  onCreate?: (name: string) => void
  canCreate?: boolean
  placeholder?: string
  /** Clientes que no se ofrecen (p. ej. los ya elegidos). */
  exclude?: string[]
  autoFocus?: boolean
}

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Buscar y asignar un cliente existente al ticket (o darlo de alta ahí mismo). */
export function CustomerPicker({ customers, onPick, onCreate, canCreate = true, placeholder, exclude, autoFocus }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const results = useMemo(() => {
    const words = normalize(query.trim()).split(/\s+/).filter(Boolean)
    return customers
      .filter((c) => {
        if (exclude?.includes(c.id)) return false
        const text = normalize(`${c.name} ${c.phone ?? ''} ${c.email ?? ''} ${c.code ?? ''}`)
        return words.every((w) => text.includes(w))
      })
      .slice(0, 8)
  }, [query, customers, exclude])

  function pick(c: Customer) {
    onPick(c)
    setQuery('')
    setOpen(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      if (results.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // Código de cliente exacto (lector): se asigna directo.
      const byCode = findByCode(customers, query)
      if (byCode && !exclude?.includes(byCode.id)) pick(byCode)
      else if (results[active]) pick(results[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <Icon name="users" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-subtle" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setActive(0)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? 'Asignar cliente (nombre, teléfono o código)…'}
          aria-label={placeholder ?? 'Asignar cliente'}
          autoFocus={autoFocus}
          autoComplete="off"
          className="field pl-9"
        />
        {open && (results.length > 0 || query.trim()) && (
          <ul
            className="absolute z-20 mt-1 max-h-80 w-full divide-y divide-line overflow-auto border-2 border-line-side bg-surface shadow-popover"
            role="listbox"
          >
            {results.map((c, i) => (
              <li key={c.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(c)}
                  className={`flex w-full cursor-pointer flex-col gap-1 px-3 py-2 text-left ${i === active ? 'bg-brand-soft' : 'hover:bg-subtle'}`}
                >
                  <span className="text-label text-ink">
                    {c.name}
                    {c.phone && <span className="ml-2 text-caption text-ink-subtle">{c.phone}</span>}
                  </span>
                  {c.games.length > 0 && <GameTags games={c.games} max={3} />}
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="px-3 py-2 text-ink-subtle">Ningún cliente coincide.</li>}
          </ul>
        )}
      </div>
      {onCreate && (
        <button
          type="button"
          onClick={() => onCreate(query.trim())}
          disabled={!canCreate}
          title={canCreate ? undefined : 'Se necesita conexión para dar de alta clientes'}
          className="btn btn-secondary"
        >
          <Icon name="plus" />
          Nuevo cliente
        </button>
      )}
    </div>
  )
}
