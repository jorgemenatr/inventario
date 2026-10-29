import { useCallback, useEffect, useState } from 'react'
import { getCreditBalance, listCreditHistory } from '../lib/credits'
import { formatDateTime, formatMoney } from '../lib/format'
import { ticketFolio } from '../lib/sales'
import { isNetworkError } from '../lib/supabase'
import type { CreditBalance, CreditMovementRow, Customer } from '../lib/types'
import { CreditsModal } from './CreditsModal'
import { Icon } from './Icon'

/** Créditos de tienda en el perfil del cliente: saldo, ganados/usados e historial. */
export function CustomerCredits({ customer }: { customer: Customer }) {
  const [balance, setBalance] = useState<CreditBalance | null>(null)
  const [history, setHistory] = useState<CreditMovementRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    Promise.all([getCreditBalance(customer.id), listCreditHistory(customer.id)])
      .then(([b, h]) => {
        setBalance(b)
        setHistory(h)
      })
      .catch((e) => setError(isNetworkError(e) ? 'Sin conexión: no se pueden cargar los créditos.' : (e as Error).message))
  }, [customer.id])

  useEffect(() => {
    setBalance(null)
    setHistory(null)
    setSaved(null)
    load()
  }, [load])

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-title">Créditos de tienda</h2>
        <button type="button" onClick={() => setAdding(true)} className="btn btn-secondary">
          <Icon name="plus" />
          Agregar crédito
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

      <div className="grid grid-cols-3 items-start gap-3 max-sm:grid-cols-2">
        {/* StatBlock dorado: el saldo es dinero a favor del cliente. */}
        <div className="kn-block kn-gold kn-deep flex flex-col gap-1 p-4 max-sm:col-span-2" role="group" aria-label="Créditos disponibles">
          <p className="stat-label">Disponible</p>
          <p className="stat-value">{balance ? formatMoney(balance.balance) : '…'}</p>
        </div>
        <div className="card p-4">
          <p className="stat-label text-ink-muted">Ganados (histórico)</p>
          <p className="font-display text-heading font-extrabold text-success-fg tabular-nums">{balance ? formatMoney(balance.earned) : '…'}</p>
        </div>
        <div className="card p-4">
          <p className="stat-label text-ink-muted">Usados (histórico)</p>
          <p className="font-display text-heading font-extrabold tabular-nums">{balance ? formatMoney(balance.used) : '…'}</p>
        </div>
      </div>

      {history && (
        <div className="card overflow-x-auto">
          {/* Celular: un renglón por movimiento. */}
          <ul className="divide-y divide-line md:hidden">
            {history.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 space-y-0.5">
                  <p>
                    {m.kind === 'sale' ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="badge badge-neutral">Compra</span>
                        #{ticketFolio(m.ticket_name)}
                      </span>
                    ) : (
                      m.note
                    )}
                  </p>
                  <p className="text-caption text-ink-muted">
                    {formatDateTime(m.created_at)} · {m.created_by_name || m.created_by_email || '—'}
                  </p>
                </div>
                <span className={`shrink-0 font-medium tabular-nums ${m.amount > 0 ? 'text-success-fg' : 'text-danger-fg'}`}>
                  {m.amount > 0 ? '+' : '−'}
                  {formatMoney(Math.abs(m.amount))}
                </span>
              </li>
            ))}
          </ul>
          <table className="hidden w-full border-collapse text-left md:table">
            <thead>
              <tr className="thead-row">
                <th className="h-control-md px-4 font-medium">Fecha</th>
                <th className="h-control-md px-4 font-medium">Concepto</th>
                <th className="h-control-md px-4 text-right font-medium">Créditos</th>
                <th className="h-control-md px-4 font-medium">Registró</th>
              </tr>
            </thead>
            <tbody>
              {history.map((m) => (
                <tr key={m.id} className="border-t border-line">
                  <td className="h-row px-4 whitespace-nowrap text-ink-muted">{formatDateTime(m.created_at)}</td>
                  <td className="h-row px-4">
                    {m.kind === 'sale' ? (
                      <span className="flex items-center gap-2">
                        <span className="badge badge-neutral">Compra</span>
                        #{ticketFolio(m.ticket_name)}
                      </span>
                    ) : (
                      m.note
                    )}
                  </td>
                  <td className={`h-row px-4 text-right font-medium tabular-nums ${m.amount > 0 ? 'text-success-fg' : 'text-danger-fg'}`}>
                    {m.amount > 0 ? '+' : '−'}
                    {formatMoney(Math.abs(m.amount))}
                  </td>
                  <td className="h-row px-4 text-ink-muted">{m.created_by_name || m.created_by_email || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.length === 0 && <p className="px-4 py-8 text-center text-ink-subtle">Este cliente aún no tiene créditos.</p>}
        </div>
      )}

      {adding && (
        <CreditsModal
          customers={[customer]}
          fixedCustomer={customer}
          onCancel={() => setAdding(false)}
          onSaved={(r) => {
            setAdding(false)
            setSaved(`Se agregaron ${formatMoney(r.total)} en créditos.`)
            load()
          }}
        />
      )}
    </section>
  )
}
