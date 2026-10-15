import { useCallback, useEffect, useState } from 'react'
import { formatDay, formatPoints, listLeagueHistory } from '../lib/league'
import { formatDateTime } from '../lib/format'
import { isNetworkError } from '../lib/supabase'
import type { Customer, LeaguePointsRow } from '../lib/types'
import { Icon } from './Icon'
import { LeaguePointsModal } from './LeaguePointsModal'

/** Puntos de liga en el perfil del cliente: total e historial (cantidad, comentario, fecha y quién). */
export function CustomerLeaguePoints({ customer }: { customer: Customer }) {
  const [history, setHistory] = useState<LeaguePointsRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    listLeagueHistory(customer.id)
      .then(setHistory)
      .catch((e) => setError(isNetworkError(e) ? 'Sin conexión: no se pueden cargar los puntos de liga.' : (e as Error).message))
  }, [customer.id])

  useEffect(() => {
    setHistory(null)
    setSaved(null)
    load()
  }, [load])

  const total = history?.reduce((sum, r) => sum + r.points, 0)

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-heading">Puntos de liga</h2>
        <button type="button" onClick={() => setAdding(true)} className="btn btn-primary">
          <Icon name="plus" />
          Agregar puntos
        </button>
      </div>

      {saved && (
        <p className="notice bg-success-bg text-success-fg" role="status">
          <Icon name="check" className="mt-0.5" />
          {saved}
        </p>
      )}
      {error && (
        <p className="notice bg-danger-bg text-danger-fg">
          <Icon name="alert" className="mt-0.5" />
          {error}
        </p>
      )}

      <div className="card flex items-center gap-3 p-4">
        <span className="grid size-10 place-items-center rounded-pill bg-brand-soft text-brand-ink">
          <Icon name="trophy" size={20} />
        </span>
        <div>
          <p className="text-label text-ink-muted">Total</p>
          <p className="text-kpi text-brand-ink tabular-nums">{total == null ? '…' : `${total.toLocaleString('es-MX')} pts`}</p>
        </div>
      </div>

      {history && (
        <div className="card overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-subtle text-label whitespace-nowrap text-ink-muted">
                <th className="h-control-md px-4 font-medium">Fecha</th>
                <th className="h-control-md px-4 text-right font-medium">Puntos</th>
                <th className="h-control-md px-4 font-medium">Comentario</th>
                <th className="h-control-md px-4 font-medium">Asignó</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="h-row px-4 whitespace-nowrap">{formatDay(r.awarded_on)}</td>
                  <td className={`h-row px-4 text-right font-medium tabular-nums ${r.points > 0 ? 'text-success-fg' : 'text-danger-fg'}`}>
                    {formatPoints(r.points)}
                  </td>
                  <td className="h-row px-4">{r.note || <span className="text-ink-subtle">—</span>}</td>
                  <td className="h-row px-4 text-ink-muted" title={`Registrado ${formatDateTime(r.created_at)}`}>
                    {r.created_by_name || r.created_by_email || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.length === 0 && <p className="px-4 py-8 text-center text-ink-subtle">Este cliente aún no tiene puntos de liga.</p>}
        </div>
      )}

      {adding && (
        <LeaguePointsModal
          customers={[customer]}
          fixedCustomer={customer}
          onCancel={() => setAdding(false)}
          onSaved={(r) => {
            setAdding(false)
            setSaved(`Se registraron ${formatPoints(r.total)} puntos de liga.`)
            load()
          }}
        />
      )}
    </section>
  )
}
