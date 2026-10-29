import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDateTime, formatInt, formatMoney } from '../lib/format'
import { getTicketItems, getTicketPayments, saleTitle } from '../lib/sales'
import { PAYMENT_LABELS, PAYMENT_METHODS, type SaleRow, type TicketItemRow, type TicketPaymentRow } from '../lib/types'
import { Icon } from './Icon'

interface Detail {
  items: TicketItemRow[]
  payments: TicketPaymentRow[]
}

interface Props {
  sales: SaleRow[]
  /** Ocultar la columna de cliente (p. ej. en el detalle de un cliente). */
  hideCustomer?: boolean
  emptyText: string
}

/** Tabla de ventas cobradas; cada fila se despliega para ver los productos. */
export function SalesTable({ sales, hideCustomer, emptyText }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const [items, setItems] = useState<Record<string, Detail | 'error'>>({})

  function toggle(id: string) {
    setOpen((o) => (o === id ? null : id))
    if (!items[id]) {
      Promise.all([getTicketItems(id), getTicketPayments(id)])
        .then(([rows, payments]) => setItems((m) => ({ ...m, [id]: { items: rows, payments } })))
        .catch(() => setItems((m) => ({ ...m, [id]: 'error' })))
    }
  }

  return (
    <div className="card overflow-x-auto">
      {/* Celular: una tarjeta por venta; se despliega igual que la fila. */}
      <ul className="divide-y divide-line md:hidden">
        {sales.map((s) => {
          const expanded = open === s.id
          return (
            <li key={s.id} className={expanded ? 'bg-subtle' : ''}>
              <div className="flex cursor-pointer items-start gap-3 px-4 py-3" onClick={() => toggle(s.id)}>
                <div className="min-w-0 flex-1 space-y-1">
                  <SaleTitle sale={s} expanded={expanded} withCustomer={!hideCustomer} />
                  <p className="text-caption text-ink-muted">
                    {formatDateTime(s.paid_at)} · {formatInt(s.item_count)} art. ·{' '}
                    {s.payment_method === 'mixed' ? 'Mixto' : PAYMENT_LABELS[s.payment_method]}
                  </p>
                </div>
                <span className="shrink-0 font-medium tabular-nums">{formatMoney(s.total)}</span>
                <ToggleButton sale={s} expanded={expanded} onToggle={() => toggle(s.id)} />
              </div>
              {expanded && (
                <div className="px-4 pb-4">
                  <SaleDetail sale={s} detail={items[s.id]} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <table className="hidden w-full border-collapse text-left md:table">
        <thead>
          <tr className="bg-subtle text-label whitespace-nowrap text-ink-muted">
            <th className="h-control-md w-8 px-3">
              <span className="sr-only">Detalle</span>
            </th>
            <th className="h-control-md px-3 font-medium">Fecha</th>
            <th className="h-control-md px-3 font-medium">Venta</th>
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
                    <ToggleButton sale={s} expanded={expanded} onToggle={() => toggle(s.id)} />
                  </td>
                  <td className="h-row px-3 whitespace-nowrap text-ink-muted">{formatDateTime(s.paid_at)}</td>
                  <td className="h-row px-3">
                    <SaleTitle sale={s} expanded={expanded} withCustomer={!hideCustomer} />
                  </td>
                  <td className="h-row px-3 text-right tabular-nums">{formatInt(s.item_count)}</td>
                  <td className="h-row px-3 whitespace-nowrap">
                    {s.payment_method === 'mixed' ? <span className="badge badge-info">Mixto</span> : PAYMENT_LABELS[s.payment_method]}
                  </td>
                  <td className="h-row px-3 text-right font-medium tabular-nums">{formatMoney(s.total)}</td>
                </tr>
                {expanded && (
                  <tr className="bg-subtle">
                    <td />
                    <td colSpan={5} className="px-3 pb-4">
                      <SaleDetail sale={s} detail={detail} />
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

/** "140. Ana Martínez"; ya desplegada, un ojo junto al nombre abre al cliente. */
function SaleTitle({ sale: s, expanded, withCustomer }: { sale: SaleRow; expanded: boolean; withCustomer: boolean }) {
  return (
    <p className="flex flex-wrap items-center gap-2 font-medium">
      {saleTitle(s, withCustomer)}
      {expanded && withCustomer && s.customer_id && (
        <Link
          to={`/clientes/${s.customer_id}`}
          onClick={(e) => e.stopPropagation()}
          title="Ver cliente"
          aria-label={`Ver cliente ${s.customer_name ?? ''}`}
          className="-my-1 grid size-8 place-items-center rounded-md text-ink-muted hover:bg-surface hover:text-brand-ink"
        >
          <Icon name="eye" />
        </Link>
      )}
      {s.paid_offline && <span className="badge badge-neutral font-normal">Sin conexión</span>}
    </p>
  )
}

function ToggleButton({ sale: s, expanded, onToggle }: { sale: SaleRow; expanded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      aria-expanded={expanded}
      aria-label={`Ver productos de la venta ${saleTitle(s)}`}
      className="grid size-6 shrink-0 cursor-pointer place-items-center text-ink-subtle"
    >
      <Icon name={expanded ? 'chevron-up' : 'chevron-down'} />
    </button>
  )
}

/** Productos, pagos y quién cobró un ticket (al desplegar la fila). */
function SaleDetail({ sale: s, detail }: { sale: SaleRow; detail: Detail | 'error' | undefined }) {
  return (
    <>
      {!detail && <p className="py-2 text-ink-subtle">Cargando productos…</p>}
      {detail === 'error' && <p className="py-2 text-danger-fg">No se pudieron cargar los productos.</p>}
      {detail && detail !== 'error' && (
        <table className="w-full max-w-3xl border-collapse text-left max-md:block">
          <tbody className="max-md:block">
            {detail.items.map((i) => (
              <tr key={i.id} className="border-b border-line last:border-0 max-md:flex max-md:flex-wrap max-md:items-baseline max-md:gap-x-3 max-md:py-2">
                <td className="py-1.5 pr-3 max-md:basis-full max-md:p-0">
                  {i.product_name}
                  <span className="ml-2 font-mono text-caption text-ink-subtle">{i.barcode}</span>
                </td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap text-ink-muted tabular-nums max-md:mr-auto max-md:p-0 max-md:text-caption">
                  {formatInt(i.quantity)} × {formatMoney(i.unit_price)}
                </td>
                <td className="py-1.5 text-right font-medium tabular-nums max-md:p-0">{formatMoney(i.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {detail && detail !== 'error' && detail.payments.length > 0 && (
        <div className="mt-3 max-w-3xl">
          <p className="text-label text-ink-muted">{detail.payments.length > 1 ? 'Pago mixto' : 'Pago'}</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {[...detail.payments]
              .sort((a, b) => PAYMENT_METHODS.indexOf(a.method) - PAYMENT_METHODS.indexOf(b.method))
              .map((p) => (
                <li key={p.id} className="inline-flex items-center gap-2 rounded-pill border border-line bg-surface px-3 py-1 text-label">
                  {PAYMENT_LABELS[p.method]}
                  <span className="tabular-nums">{formatMoney(p.amount)}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
      <p className="mt-2 text-caption text-ink-subtle">
        Cobró {s.created_by_name || s.created_by_email || '—'}
        {s.opened_at && ` · abierto ${formatDateTime(s.opened_at)}`}
      </p>
      {s.note && <p className="mt-1 text-caption text-warning-fg">{s.note}</p>}
    </>
  )
}
