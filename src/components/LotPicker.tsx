import { useEffect, useMemo, useState } from 'react'
import { formatDateTime, formatInt, formatMoney, parseCount } from '../lib/format'
import { getProductLots } from '../lib/lots'
import { isNetworkError } from '../lib/supabase'
import { LOCATION_LABELS, LOT_ORIGIN_LABELS, type LotPick, type ProductLot, type StockLocation } from '../lib/types'
import { Icon } from './Icon'

interface Props {
  productId: string
  productName: string
  location: StockLocation
  /** Piezas que hay que sacar. */
  remove: number
  /** Para qué (p. ej. "Merma"), se muestra en el título. */
  purpose?: string
  onCancel: () => void
  onConfirm: (picks: LotPick[]) => void
}

/**
 * Elegir de qué lotes salen las piezas al bajar existencias (merma, ajuste,
 * fijar total). Muestra los lotes de esa ubicación con proveedor y costo.
 */
export function LotPicker({ productId, productName, location, remove, purpose, onCancel, onConfirm }: Props) {
  const [lots, setLots] = useState<ProductLot[] | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getProductLots(productId, location)
      .then((l) => {
        setLots(l)
        // Con un solo lote no hay nada que decidir.
        if (l.length === 1) setValues({ [l[0].lot_id]: String(Math.min(remove, l[0].quantity)) })
      })
      .catch((e) => setError(isNetworkError(e) ? 'Sin conexión: elegir el lote necesita internet.' : (e as Error).message))
  }, [productId, location, remove])

  const picks = useMemo(
    () =>
      (lots ?? []).map((l) => {
        const t = (values[l.lot_id] ?? '').trim()
        const n = t === '' ? 0 : parseCount(t)
        return { lot: l, n, invalid: Number.isNaN(n) || n > l.quantity }
      }),
    [lots, values],
  )
  const chosen = picks.reduce((s, p) => s + (Number.isNaN(p.n) ? 0 : p.n), 0)
  const invalid = picks.some((p) => p.invalid)
  const ok = !invalid && chosen === remove

  const confirm = () => onConfirm(picks.filter((p) => p.n > 0).map((p) => ({ lot_id: p.lot.lot_id, quantity: p.n })))

  /** Reparte del lote más viejo al más nuevo. */
  function fillOldest() {
    let left = remove
    const next: Record<string, string> = {}
    for (const l of lots ?? []) {
      const take = Math.min(left, l.quantity)
      next[l.lot_id] = take > 0 ? String(take) : ''
      left -= take
    }
    setValues(next)
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="lp-title">
      <div
        className="max-h-full w-full max-w-2xl overflow-auto rounded-lg border border-line bg-surface shadow-popover"
        onKeyDown={(e) => {
          // Puede abrirse dentro de otro formulario: Enter y Esc no deben llegar a él.
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation()
            if (ok) confirm()
          }
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <h2 id="lp-title" className="text-title">
              ¿De qué lote salen? {purpose && <span className="text-ink-muted">· {purpose}</span>}
            </h2>
            <p className="mt-1 text-ink-muted">
              {productName} · {LOCATION_LABELS[location]} · hay que sacar{' '}
              <span className="font-medium text-ink tabular-nums">{formatInt(remove)}</span> pzas
            </p>
          </div>
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            <Icon name="x" />
            Cancelar
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {!lots && !error && <p className="py-6 text-center text-ink-subtle">Cargando lotes…</p>}
          {lots && lots.length === 0 && (
            <p className="notice bg-warning-bg text-warning-fg">
              <Icon name="alert" className="mt-0.5" />
              No hay lotes con piezas en {LOCATION_LABELS[location].toLowerCase()}.
            </p>
          )}
          {lots && lots.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-subtle text-label whitespace-nowrap text-ink-muted">
                    <th className="h-control-md px-3 font-medium">Lote</th>
                    <th className="h-control-md px-3 font-medium">Proveedor</th>
                    <th className="h-control-md px-3 text-right font-medium">Costo</th>
                    <th className="h-control-md px-3 text-right font-medium">Hay</th>
                    <th className="h-control-md px-3 text-right font-medium">Sacar</th>
                  </tr>
                </thead>
                <tbody>
                  {picks.map(({ lot, invalid }) => (
                    <tr key={lot.lot_id} className="border-t border-line">
                      <td className="px-3 py-2">
                        <p className="font-medium">Lote {lot.number}</p>
                        <p className="text-caption text-ink-muted">
                          {LOT_ORIGIN_LABELS[lot.origin]} · {formatDateTime(lot.received_at)}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-ink-muted">{lot.supplier_name ?? 'Sin proveedor'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(lot.unit_cost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatInt(lot.quantity)}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          value={values[lot.lot_id] ?? ''}
                          onChange={(e) => setValues((v) => ({ ...v, [lot.lot_id]: e.target.value }))}
                          inputMode="numeric"
                          autoComplete="off"
                          aria-label={`Piezas a sacar del lote ${lot.number}`}
                          aria-invalid={invalid}
                          placeholder="0"
                          className={`field h-9 w-20 text-right tabular-nums ${invalid ? 'border-danger-fg bg-danger-bg text-danger-fg' : ''}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {lots && lots.length > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className={chosen === remove ? 'text-success-fg' : 'text-ink-muted'}>
                Elegidas <span className="font-medium tabular-nums">{formatInt(chosen)}</span> de{' '}
                <span className="tabular-nums">{formatInt(remove)}</span>
              </p>
              <button type="button" onClick={fillOldest} className="btn btn-secondary btn-sm">
                Repartir del más viejo
              </button>
            </div>
          )}

          {error && (
            <p className="notice bg-danger-bg text-danger-fg">
              <Icon name="alert" className="mt-0.5" />
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-line bg-subtle px-6 py-4">
          <button
            type="button"
            disabled={!ok}
            onClick={confirm}
            className="btn btn-primary btn-lg w-full sm:w-auto"
          >
            <Icon name="check" size={20} />
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}
