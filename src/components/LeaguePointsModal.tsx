import { useMemo, useRef, useState, type FormEvent } from 'react'
import { formatPoints, grantLeaguePoints, todayISO } from '../lib/league'
import { isNetworkError } from '../lib/supabase'
import type { Customer } from '../lib/types'
import { Icon } from './Icon'
import { CustomerPicker } from './pos/CustomerPicker'

interface Props {
  /** Clientes para elegir (en modo varios). */
  customers: Customer[]
  /** Si viene, el modal es para este cliente nada más (desde su perfil). */
  fixedCustomer?: Customer
  onCancel: () => void
  onSaved: (result: { count: number; total: number }) => void
}

interface Row {
  key: string
  customer: Customer | null
  points: string
}

const newRow = (customer: Customer | null = null): Row => ({ key: crypto.randomUUID(), customer, points: '' })

/** Entero distinto de 0 (se aceptan negativos para corregir). null = vacío; NaN = inválido. */
function parsePoints(text: string): number | null {
  const t = text.trim().replace('−', '-')
  if (!t) return null
  if (!/^[-+]?\d{1,6}$/.test(t)) return NaN
  const n = Number(t)
  return n === 0 ? NaN : n
}

/**
 * Agregar puntos de liga: a un cliente (desde su perfil) o a varios a la vez
 * (p. ej. resultados de una liga), con la misma fecha y comentario. Quien los
 * asigna queda registrado automáticamente (el usuario con sesión iniciada).
 */
export function LeaguePointsModal({ customers, fixedCustomer, onCancel, onSaved }: Props) {
  const [awardedOn, setAwardedOn] = useState(todayISO)
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<Row[]>([newRow(fixedCustomer ?? null)])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Un id por apertura del modal: si se reintenta el guardado, no se duplica.
  const batchId = useRef(crypto.randomUUID())

  const chosen = rows.map((r) => r.customer?.id).filter((id): id is string => !!id)
  const total = useMemo(() => rows.reduce((sum, r) => sum + (parsePoints(r.points) || 0), 0), [rows])

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    setError(null)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(awardedOn)) return setError('Elige la fecha.')
    const filled = rows.filter((r) => r.customer || r.points.trim())
    if (filled.length === 0) return setError('Agrega al menos un cliente con sus puntos.')
    const grants = []
    for (const r of filled) {
      if (!r.customer) return setError('Hay un renglón con puntos pero sin cliente.')
      const points = parsePoints(r.points)
      if (points === null || Number.isNaN(points)) {
        return setError(`Los puntos de ${r.customer.name} deben ser un número entero distinto de 0.`)
      }
      grants.push({ customerId: r.customer.id, points })
    }
    setSaving(true)
    try {
      onSaved(await grantLeaguePoints(batchId.current, awardedOn, note, grants))
    } catch (err) {
      setError(isNetworkError(err) ? 'Sin conexión: los puntos se agregan cuando vuelva el internet.' : (err as Error).message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-brand-side/60 p-4" role="dialog" aria-modal="true" aria-labelledby="lp-title">
      <form
        noValidate
        onSubmit={onSubmit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        className="max-h-full w-full max-w-2xl overflow-auto dialog"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div>
            <h2 id="lp-title" className="text-title">
              Agregar puntos de liga
            </h2>
            <p className="mt-1 text-ink-muted">
              {fixedCustomer ? fixedCustomer.name : 'A uno o varios clientes con la misma fecha y comentario.'}
            </p>
          </div>
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            <Icon name="x" />
            Cancelar<span className="hidden md:inline"> (Esc)</span>
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <div>
              <label className="field-label" htmlFor="lp-date">Fecha *</label>
              <input id="lp-date" type="date" value={awardedOn} onChange={(e) => setAwardedOn(e.target.value)} className="field" />
            </div>
            <div>
              <label className="field-label" htmlFor="lp-note">Comentario</label>
              <input
                id="lp-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ej. Liga Pokémon, semana 3 (2do lugar)"
                autoFocus
                autoComplete="off"
                className="field"
              />
            </div>
          </div>

          <div>
            <span className="field-label">{fixedCustomer ? 'Puntos *' : 'Clientes y puntos *'}</span>
            <ul className="space-y-2">
              {rows.map((r, i) => (
                <li key={r.key} className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    {r.customer ? (
                      <span className="flex h-control-md items-center gap-2 rounded-md border border-line bg-subtle px-3">
                        <Icon name="users" className="text-ink-subtle" />
                        <span className="truncate">{r.customer.name}</span>
                        {!fixedCustomer && (
                          <button
                            type="button"
                            onClick={() => update(r.key, { customer: null })}
                            className="ml-auto cursor-pointer text-caption text-ink-muted hover:text-ink"
                          >
                            Cambiar
                          </button>
                        )}
                      </span>
                    ) : (
                      <CustomerPicker
                        customers={customers}
                        exclude={chosen}
                        placeholder="Buscar cliente…"
                        canCreate={false}
                        autoFocus={i > 0}
                        onPick={(c) => update(r.key, { customer: c })}
                      />
                    )}
                  </div>
                  <div className="flex w-32 items-center gap-1">
                    <input
                      value={r.points}
                      onChange={(e) => update(r.key, { points: e.target.value })}
                      inputMode="numeric"
                      placeholder="0"
                      aria-label={`Puntos para ${r.customer?.name ?? 'el cliente'}`}
                      autoComplete="off"
                      className="field text-right tabular-nums"
                    />
                    <span className="text-ink-muted">pts</span>
                  </div>
                  {!fixedCustomer && rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                      aria-label="Quitar renglón"
                      className="grid size-11 shrink-0 cursor-pointer place-items-center text-ink-muted hover:bg-danger-bg hover:text-danger-fg"
                    >
                      <Icon name="x" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!fixedCustomer && (
              <button type="button" onClick={() => setRows((rs) => [...rs, newRow()])} className="btn btn-ghost btn-sm mt-2">
                <Icon name="plus" />
                Agregar otra persona
              </button>
            )}
            <p className="mt-2 text-caption text-ink-subtle">Para corregir, registra puntos negativos (p. ej. −2).</p>
          </div>

          {error && (
            <p className="notice bg-danger-bg text-danger-fg">
              <Icon name="alert" className="mt-0.5" />
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line bg-subtle px-6 py-4">
          {!fixedCustomer && (
            <span className="mr-auto text-ink-muted">
              {chosen.length} cliente(s) · <span className="font-medium text-ink tabular-nums">{formatPoints(total)} pts</span>
            </span>
          )}
          <button type="submit" disabled={saving} className="btn btn-gold btn-lg w-full sm:w-auto">
            <Icon name="check" size={20} />
            {saving ? 'Guardando…' : 'Agregar puntos'}
          </button>
        </div>
      </form>
    </div>
  )
}
