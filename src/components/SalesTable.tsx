import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDateTime, formatInt, formatMoney } from '../lib/format'
import { getTicketItems } from '../lib/sales'
import { PAYMENT_LABELS, type SaleRow, type TicketItemRow } from '../lib/types'
import { Icon } from './Icon'

interface Props {
  sales: SaleRow[]
  /** Ocultar la columna de cliente (p. ej. en el detalle de un cliente). */
  hideCustomer?: boolean
  emptyText: string
}

/** Tabla de ventas cobradas; cada fila se despliega para ver los productos. */
export function SalesTable({ sales, hideCustomer, emptyText }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const [items, setItems] = useState<Record<string, TicketItemRow[] | 'error'>>({})

  function toggle(id: string) {
    setOpen((o) => (o === id ? null : id))
    if (!items[id]) {
      getTicketItems(id)
        .then((rows) => setItems((m) => ({ ...m, [id]: rows })))
        .catch(() => setItems((m) => ({ ...m, [id]: 'error' })))
    }
  }

  const cols = hideCustomer ? 6 : 7

  return (
    <div className="card overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-subtle text-label whitespace-nowrap text-ink-muted">
            <th className="h-control-md w-8 px-3">
              <span className="sr-only">Detalle</span>
            </th>
            <th className="h-control-md px-3 font-medium">Fecha</th>
            <th className="h-control-md px-3 font-medium">Ticket</th>
            {!hideCustomer && <th className="h-control-md px-3 font-medium">Cliente</th>}
            <th className="h-control-md px-3 text-right font-medium">Artículos</th>
            <th className="h-control-md px-3 font-medium">Pago</th>
            <th className="h-control-md px-3 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {sales.map((s) => {
            const expanded = open === s.id
            const detail = items[s.id]
            return (
              <Fragment key={s.id}>
                <tr
                  className={`cursor-pointer border-t border-line ${expanded ? 'bg-subtle' : 'hover:bg-subtle'}`}
                  onClick={() => toggle(s.id)}
                >
                  <td className="h-row px-3 text-ink-subtle">
                    <button type="button" aria-expanded={expanded} aria-label={`Ver productos de ${s.name}`} className="grid size-6 cursor-pointer place-items-center">
                      <Icon name={expanded ? 'chevron-up' : 'chevron-down'} />
                    </button>
                  </td>
                  <td className="h-row px-3 whitespace-nowrap text-ink-muted">{formatDateTime(s.paid_at)}</td>
                  <td className="h-row px-3 font-medium">
                    <span className="flex items-center gap-2">
                      {s.name}
                      {s.paid_offline && <span className="badge badge-neutral">Sin conexión</span>}
                    </span>
                  </td>
                  {!hideCustomer && (
                    <td className="h-row px-3">
                      {s.customer_id ? (
                        <Link to={`/clientes/${s.customer_id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                          {s.customer_name}
                        </Link>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </td>
                  )}
                  <td className="h-row px-3 text-right tabular-nums">{formatInt(s.item_count)}</td>
                  <td className="h-row px-3 whitespace-nowrap">{PAYMENT_LABELS[s.payment_method]}</td>
                  <td className="h-row px-3 text-right font-medium tabular-nums">{formatMoney(s.total)}</td>
                </tr>
                {expanded && (
                  <tr className="bg-subtle">
                    <td />
                    <td colSpan={cols - 1} className="px-3 pb-4">
                      {!detail && <p className="py-2 text-ink-subtle">Cargando productos…</p>}
                      {detail === 'error' && <p className="py-2 text-danger-fg">No se pudieron cargar los productos.</p>}
                      {Array.isArray(detail) && (
                        <table className="w-full max-w-3xl border-collapse text-left">
                          <tbody>
                            {detail.map((i) => (
                              <tr key={i.id} className="border-b border-line last:border-0">
                                <td className="py-1.5 pr-3">
                                  {i.product_name}
                                  <span className="ml-2 font-mono text-caption text-ink-subtle">{i.barcode}</span>
                                </td>
                                <td className="py-1.5 pr-3 text-right whitespace-nowrap text-ink-muted tabular-nums">
                                  {formatInt(i.quantity)} × {formatMoney(i.unit_price)}
                                </td>
                                <td className="py-1.5 text-right font-medium tabular-nums">{formatMoney(i.line_total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <p className="mt-2 text-caption text-ink-subtle">
                        Cobró {s.created_by_name || s.created_by_email || '—'}
                        {s.opened_at && ` · abierto ${formatDateTime(s.opened_at)}`}
                      </p>
                      {s.note && <p className="mt-1 text-caption text-warning-fg">{s.note}</p>}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {sales.length === 0 && <p className="px-4 py-10 text-center text-ink-subtle">{emptyText}</p>}
    </div>
  )
}
