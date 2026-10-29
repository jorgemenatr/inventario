import { useState, type KeyboardEvent } from 'react'
import { Icon } from './Icon'

interface Props {
  id?: string
  value: string[]
  onChange: (games: string[]) => void
  /** Juegos para elegir con un clic (los fijos + los que ya usan otros clientes). */
  suggestions: string[]
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Selección múltiple de juegos como tags: un clic en un juego lo agrega o lo
 * quita, y "Otro juego" permite escribir uno que no esté en la lista.
 */
export function GamesInput({ id, value, onChange, suggestions }: Props) {
  const [other, setOther] = useState('')

  const has = (g: string) => value.some((v) => same(v, g))
  const toggle = (g: string) => onChange(has(g) ? value.filter((v) => !same(v, g)) : [...value, g])

  function addOther() {
    const g = other.trim()
    if (!g) return
    if (!has(g)) {
      // Si coincide con una sugerencia, se usa como está escrita ahí.
      onChange([...value, suggestions.find((s) => same(s, g)) ?? g])
    }
    setOther('')
  }

  function onOtherKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      // Enter aquí agrega el juego; no envía el formulario.
      e.preventDefault()
      addOther()
    }
  }

  const options = [...suggestions, ...value.filter((v) => !suggestions.some((s) => same(s, v)))]

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Juegos que juega">
        {options.map((g) => {
          const on = has(g)
          return (
            <button
              key={g}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(g)}
className="choice choice-sm"
            >
              {on && <Icon name="check" size={14} />}
              {g}
            </button>
          )
        })}
      </div>
      <div className="mt-3 flex max-w-sm gap-2">
        <input
          id={id}
          value={other}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={onOtherKeyDown}
          placeholder="Otro juego…"
          autoComplete="off"
          className="field"
        />
        <button type="button" onClick={addOther} disabled={!other.trim()} className="btn btn-secondary">
          <Icon name="plus" />
          Agregar
        </button>
      </div>
    </div>
  )
}

/** Tags de solo lectura (listas y detalle). */
export function GameTags({ games, max }: { games: string[]; max?: number }) {
  if (games.length === 0) return <span className="text-ink-subtle">—</span>
  const shown = max ? games.slice(0, max) : games
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((g) => (
        <span key={g} className="inline-flex items-center border border-jade bg-brand-soft px-2 py-0.5 text-caption font-semibold text-brand-ink">
          {g}
        </span>
      ))}
      {max && games.length > max && (
        <span className="inline-flex items-center border border-line bg-subtle px-2 py-0.5 text-caption font-semibold text-ink-muted">
          +{games.length - max}
        </span>
      )}
    </span>
  )
}
