import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CustomerFormModal } from '../components/CustomerFormModal'
import { GameTags } from '../components/GamesInput'
import { Icon } from '../components/Icon'
import { gameSuggestions, getCustomer, listCustomers } from '../lib/customers'
import { formatDateTime } from '../lib/format'
import { isNetworkError } from '../lib/supabase'
import type { Customer } from '../lib/types'

export function CustomerDetailPage() {
  const { id = '' } = useParams()
  const [customer, setCustomer] = useState<Customer | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>(gameSuggestions([]))

  useEffect(() => {
    setCustomer(undefined)
    setError(null)
    getCustomer(id)
      .then(setCustomer)
      .catch((e) => setError(isNetworkError(e) ? 'Sin conexión: no se puede cargar el cliente.' : (e as Error).message))
  }, [id])

  function openEditor() {
    setEditing(true)
    // Sugerencias con los juegos de todos los clientes (no bloquea si falla).
    listCustomers()
      .then((all) => setSuggestions(gameSuggestions(all)))
      .catch(() => undefined)
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <Link to="/clientes" className="inline-flex w-fit items-center gap-1 text-label text-ink-muted hover:text-ink">
        <Icon name="chevron-down" className="rotate-90" />
        Clientes
      </Link>

      {error && (
        <p className="notice bg-danger-bg text-danger-fg">
          <Icon name="alert" className="mt-0.5" />
          {error}
        </p>
      )}
      {customer === undefined && !error && <p className="py-10 text-center text-ink-subtle">Cargando…</p>}
      {customer === null && <p className="card px-4 py-10 text-center text-ink-subtle">No se encontró este cliente.</p>}

      {customer && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="grid size-12 shrink-0 place-items-center rounded-pill bg-brand-soft text-title text-brand-ink uppercase"
              aria-hidden
            >
              {customer.name.charAt(0)}
            </span>
            <div className="mr-auto min-w-0">
              <h1 className="truncate text-title">{customer.name}</h1>
              <p className="text-caption text-ink-subtle">Cliente desde {formatDateTime(customer.created_at)}</p>
            </div>
            <button type="button" onClick={openEditor} className="btn btn-secondary">
              Editar
            </button>
          </div>

          <section className="card grid gap-4 p-5 sm:grid-cols-2">
            <div>
              <p className="field-label">Teléfono</p>
              <p>{customer.phone ? <a href={`tel:${customer.phone}`} className="hover:underline">{customer.phone}</a> : '—'}</p>
            </div>
            <div>
              <p className="field-label">Correo</p>
              <p className="break-all">{customer.email ? <a href={`mailto:${customer.email}`} className="hover:underline">{customer.email}</a> : '—'}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="field-label">Juegos que juega</p>
              <GameTags games={customer.games} />
            </div>
          </section>
        </>
      )}

      {editing && customer && (
        <CustomerFormModal
          customer={customer}
          gameSuggestions={suggestions}
          onCancel={() => setEditing(false)}
          onSaved={(c) => {
            setEditing(false)
            setCustomer(c)
          }}
        />
      )}
    </div>
  )
}
