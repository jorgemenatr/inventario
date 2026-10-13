import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CustomerFormModal } from '../components/CustomerFormModal'
import { GameTags } from '../components/GamesInput'
import { Icon } from '../components/Icon'
import { gameSuggestions, listCustomers } from '../lib/customers'
import { formatInt } from '../lib/format'
import { isNetworkError } from '../lib/supabase'
import type { Customer } from '../lib/types'

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function CustomersPage() {
  const navigate = useNavigate()
  const [customers, setCustomers] = useState<Customer[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [game, setGame] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    listCustomers()
      .then(setCustomers)
      .catch((e) => setError(isNetworkError(e) ? 'Sin conexión: no se pueden cargar los clientes.' : (e as Error).message))
  }, [])

  const suggestions = useMemo(() => gameSuggestions(customers ?? []), [customers])
  const gamesInUse = useMemo(
    () => [...new Set((customers ?? []).flatMap((c) => c.games))].sort((a, b) => a.localeCompare(b, 'es-MX')),
    [customers],
  )

  const filtered = useMemo(() => {
    const words = normalize(search.trim()).split(/\s+/).filter(Boolean)
    return (customers ?? []).filter((c) => {
      if (game && !c.games.includes(game)) return false
      const text = normalize(`${c.name} ${c.email ?? ''} ${c.phone ?? ''}`)
      return words.every((w) => text.includes(w))
    })
  }, [customers, search, game])

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-title">Clientes</h1>
        <button type="button" onClick={() => setCreating(true)} className="btn btn-primary">
          <Icon name="plus" />
          Nuevo cliente
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex h-control-md w-full max-w-sm items-center gap-2 rounded-md border border-control bg-surface px-3 text-ink-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring">
          <Icon name="search" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, correo o teléfono"
            aria-label="Buscar por nombre, correo o teléfono"
            className="min-w-0 flex-1 bg-transparent text-ink outline-none focus-visible:outline-none"
          />
        </label>
        <select value={game} onChange={(e) => setGame(e.target.value)} aria-label="Juego" className="field w-auto min-w-44 cursor-pointer">
          <option value="">Todos los juegos</option>
          {gamesInUse.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        {customers && (
          <span className="text-caption text-ink-muted">
            {formatInt(filtered.length)} de {formatInt(customers.length)} clientes
          </span>
        )}
      </div>

      {error && (
        <p className="notice bg-danger-bg text-danger-fg">
          <Icon name="alert" className="mt-0.5" />
          {error}
        </p>
      )}
      {!customers && !error && <p className="py-10 text-center text-ink-subtle">Cargando clientes…</p>}

      {customers && (
        <div className="card overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-subtle text-label whitespace-nowrap text-ink-muted">
                <th className="h-control-md px-4 font-medium">Nombre</th>
                <th className="h-control-md px-4 font-medium">Teléfono</th>
                <th className="h-control-md px-4 font-medium">Correo</th>
                <th className="h-control-md px-4 font-medium">Juegos que juega</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="cursor-pointer border-t border-line hover:bg-subtle" onClick={() => navigate(`/clientes/${c.id}`)}>
                  <td className="h-row px-4 font-medium">
                    <Link to={`/clientes/${c.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                      {c.name}
                    </Link>
                  </td>
                  <td className="h-row px-4 whitespace-nowrap text-ink-muted">{c.phone ?? '—'}</td>
                  <td className="h-row px-4 text-ink-muted">{c.email ?? '—'}</td>
                  <td className="h-row px-4 py-2">
                    <GameTags games={c.games} max={4} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="px-4 py-10 text-center text-ink-subtle">
              {customers.length === 0 ? 'Aún no hay clientes. Da de alta el primero con "Nuevo cliente".' : 'Ningún cliente coincide con la búsqueda.'}
            </p>
          )}
        </div>
      )}

      {creating && (
        <CustomerFormModal
          customer={null}
          gameSuggestions={suggestions}
          initialName={search.trim()}
          onCancel={() => setCreating(false)}
          onSaved={(c) => {
            setCreating(false)
            setCustomers((prev) => [...(prev ?? []), c].sort((a, b) => a.name.localeCompare(b.name, 'es-MX')))
            navigate(`/clientes/${c.id}`)
          }}
        />
      )}
    </div>
  )
}
