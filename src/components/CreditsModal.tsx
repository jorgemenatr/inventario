import { useMemo, useRef, useState, type FormEvent } from 'react'
import { grantCredits } from '../lib/credits'
import { formatMoney, parseMoney } from '../lib/format'
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
  amount: string
}

const newRow = (customer: Customer | null = null): Row => ({ key: crypto.randomUUID(), customer, amount: '' })

/**
 * Agregar créditos de tienda: a un cliente (desde su perfil) o a varios con el
 * mismo concepto (p. ej. premios de un torneo), cada uno con su monto.
 */
export function CreditsModal({ customers, fixedCustomer, onCancel, onSaved }: Props) {
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<Row[]>([newRow(fixedCustomer ?? null)])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Un id por apertura del modal: si se reintenta el guardado, no se duplica.
  const batchId = useRef(crypto.randomUUID())

  const chosen = rows.map((r) => r.customer?.id).filter((id): id is string => !!id)
  const total = useMemo(
    () => rows.reduce((sum, r) => sum + (Number.isNaN(parseMoney(r.amount)) ? 0 : (parseMoney(r.amount) ?? 0)), 0),
    [rows],
  )

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    setError(null)
    if (!note.trim()) return setError('Escribe el concepto (p. ej. "Premio torneo Pokémon").')
    const filled = rows.filter((r) => r.customer || r.amount.trim())
    if (filled.length === 0) return setError('Agrega al menos un cliente con su monto.')
    const grants = []
    for (const r of filled) {
      if (!r.customer) return setError('Hay un renglón con monto pero sin cliente.')
      const amount = parseMoney(r.amount)
      if (amount === null || Number.isNaN(amount) || amount <= 0) {
        return setError(`El monto de ${r.customer.name} debe ser mayor a 0.`)
      }
      grants.push({ customerId: r.customer.id, amount })
    }
    setSaving(true)
    try {
      onSaved(await grantCredits(batchId.current, note, grants))
    } catch (err) {
      setError(isNetworkError(err) ? 'Sin conexión: los créditos se agregan cuando vuelva el internet.' : (err as Error).message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="cr-title">
      <form
        noValidate
        onSubmit={onSubmit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        className="max-h-full w-full max-w-2xl overflow-auto rounded-lg border border-line bg-surface shadow-popover"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div>
            <h2 id="cr-title" className="text-title">
              {fixedCustomer ? 'Agregar crédito' : 'Agregar créditos'}
            </h2>
            <p className="mt-1 text-ink-muted">
              {fixedCustomer ? fixedCustomer.name : 'A varios clientes con el mismo concepto, cada uno con su monto.'}
            </p>
          </div>
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            <Icon name="x" />
            Cancelar (Esc)
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="field-label" htmlFor="cr-note">Concepto *</label>
            <input
              id="cr-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ej. Premio torneo Pokémon (1er lugar)"
              autoFocus
              autoComplete="off"
              className="field h-10"
            />
          </div>

          <div>
            <span className="field-label">{fixedCustomer ? 'Monto *' : 'Clientes y montos *'}</span>
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
                        autoFocus={i > 0}
                        onPick={(c) => update(r.key, { customer: c })}
                      />
                    )}
                  </div>
                  <div className="flex w-36 items-center gap-1">
                    <span className="text-ink-muted">$</span>
                    <input
                      value={r.amount}
                      onChange={(e) => update(r.key, { amount: e.target.value })}
                      inputMode="decimal"
                      placeholder="0.00"
                      aria-label={`Monto para ${r.customer?.name ?? 'el cliente'}`}
                      autoComplete="off"
                      className="field text-right tabular-nums"
                    />
                  </div>
                  {!fixedCustomer && rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                      aria-label="Quitar renglón"
                      className="grid size-8 cursor-pointer place-items-center rounded-md text-ink-muted hover:bg-danger-bg hover:text-danger-fg"
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
              {chosen.length} cliente(s) · <span className="font-medium text-ink tabular-nums">{formatMoney(total)}</span>
            </span>
          )}
          <button type="submit" disabled={saving} className="btn btn-primary btn-lg w-full sm:w-auto">
            <Icon name="check" size={20} />
            {saving ? 'Guardando…' : fixedCustomer ? 'Agregar crédito' : 'Agregar créditos'}
          </button>
        </div>
      </form>
    </div>
  )
}
