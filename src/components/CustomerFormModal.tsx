import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createCustomer, nextCustomerCode, parseNicknames, updateCustomer, validateCustomer } from '../lib/customers'
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
  const [code, setCode] = useState(customer?.code ?? '')
  const [generating, setGenerating] = useState(false)
  const [games, setGames] = useState<string[]>(customer?.games ?? [])
  const [nicknames, setNicknames] = useState((customer?.nicknames ?? []).join(', '))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => nameRef.current?.focus(), [])

  // El código solo se vincula si el cliente tiene correo y teléfono.
  const canLinkCode = !!email.trim() && !!phone.trim()

  async function generateCode() {
    setGenerating(true)
    setError(null)
    try {
      setCode(await nextCustomerCode())
    } catch (err) {
      setError(isNetworkError(err) ? 'Sin conexión: no se puede generar el código.' : (err as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    const input = { name, email, phone, code, games, nicknames: parseNicknames(nicknames) }
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-scrim p-4" role="dialog" aria-modal="true" aria-labelledby="cf-title">
      <form
        noValidate
        onSubmit={onSubmit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        className="max-h-full w-full max-w-xl overflow-auto dialog"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <h2 id="cf-title" className="text-title">
            {customer ? 'Editar cliente' : 'Cliente nuevo'}
          </h2>
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            <Icon name="x" />
            Cancelar<span className="hidden md:inline"> (Esc)</span>
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="field-label" htmlFor="cf-name">Nombre *</label>
            <input id="cf-name" ref={nameRef} className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="cf-email">Correo</label>
              <input id="cf-email" type="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label className="field-label" htmlFor="cf-phone">Teléfono</label>
              <input id="cf-phone" type="tel" className="field" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
            </div>
          </div>
          <div>
            <label className="field-label" htmlFor="cf-code">Código de cliente (opcional)</label>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Icon name="barcode" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-subtle" />
                <input
                  id="cf-code"
                  className="field pl-9 font-mono tabular-nums"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  // El lector manda Enter al final: que no guarde el formulario.
                  onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                  disabled={!canLinkCode && !code}
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="1xxxxxxx"
                  aria-describedby="cf-code-help"
                  autoComplete="off"
                />
              </div>
              <button
                type="button"
                onClick={() => void generateCode()}
                disabled={!canLinkCode || generating}
                className="btn btn-secondary"
              >
                {generating ? 'Generando…' : 'Generar'}
              </button>
            </div>
            <p id="cf-code-help" className="mt-1 text-caption text-ink-muted">
              {canLinkCode
                ? 'Escanea la tarjeta del cliente o genera uno: 8 dígitos que empiezan con 1.'
                : 'Para vincular un código, llena correo y teléfono.'}
            </p>
          </div>
          <div>
            <label className="field-label" htmlFor="cf-nicknames">
              Apodos
            </label>
            <input
              id="cf-nicknames"
              value={nicknames}
              onChange={(e) => setNicknames(e.target.value)}
              placeholder="Separados por coma. Ej. Peque, El Profe"
              autoComplete="off"
              aria-describedby="cf-nicknames-help"
              className="field"
            />
            <p id="cf-nicknames-help" className="mt-1 text-caption text-ink-muted">
              Al buscar clientes también se encuentran por apodo.
            </p>
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
