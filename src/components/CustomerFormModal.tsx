import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createCustomer, updateCustomer, validateCustomer } from '../lib/customers'
import { isNetworkError } from '../lib/supabase'
import type { Customer } from '../lib/types'
import { GamesInput } from './GamesInput'
import { Icon } from './Icon'

interface Props {
  /** null = cliente nuevo. */
  customer: Customer | null
  /** Juegos sugeridos para el multiselect. */
  gameSuggestions: string[]
  /** Nombre para precargar (p. ej. lo que se escribió en un buscador). */
  initialName?: string
  onCancel: () => void
  onSaved: (customer: Customer) => void
}

export function CustomerFormModal({ customer, gameSuggestions, initialName = '', onCancel, onSaved }: Props) {
  const [name, setName] = useState(customer?.name ?? initialName)
  const [email, setEmail] = useState(customer?.email ?? '')
  const [phone, setPhone] = useState(customer?.phone ?? '')
  const [games, setGames] = useState<string[]>(customer?.games ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => nameRef.current?.focus(), [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    const input = { name, email, phone, games }
    const invalid = validateCustomer(input)
    if (invalid) return setError(invalid)
    setSaving(true)
    setError(null)
    try {
      onSaved(customer ? await updateCustomer(customer.id, input) : await createCustomer(input))
    } catch (err) {
      setError(isNetworkError(err) ? 'Sin conexión: los clientes se guardan cuando vuelva el internet.' : (err as Error).message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="cf-title">
      <form
        noValidate
        onSubmit={onSubmit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        className="max-h-full w-full max-w-xl overflow-auto rounded-lg border border-line bg-surface shadow-popover"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <h2 id="cf-title" className="text-title">
            {customer ? 'Editar cliente' : 'Cliente nuevo'}
          </h2>
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            <Icon name="x" />
            Cancelar (Esc)
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="field-label" htmlFor="cf-name">Nombre *</label>
            <input id="cf-name" ref={nameRef} className="field h-10" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="cf-email">Correo</label>
              <input id="cf-email" type="email" className="field h-10" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label className="field-label" htmlFor="cf-phone">Teléfono</label>
              <input id="cf-phone" type="tel" className="field h-10" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
            </div>
          </div>
          <div>
            <span className="field-label">Juegos que juega</span>
            <GamesInput id="cf-other-game" value={games} onChange={setGames} suggestions={gameSuggestions} />
          </div>

          {error && (
            <p className="notice bg-danger-bg text-danger-fg">
              <Icon name="alert" className="mt-0.5" />
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-line bg-subtle px-6 py-4">
          <button type="submit" disabled={saving} className="btn btn-primary btn-lg w-full sm:w-auto">
            <Icon name="check" size={20} />
            {saving ? 'Guardando…' : customer ? 'Guardar cambios' : 'Guardar cliente'}
          </button>
        </div>
      </form>
    </div>
  )
}
