import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { SalesTable } from '../components/SalesTable'
import { formatDateTime, formatInt, formatMoney } from '../lib/format'
import { listSales, salesSummary, SALES_PAGE, type SalesFilter } from '../lib/sales'
import { isNetworkError } from '../lib/supabase'
import { PAYMENT_LABELS, PAYMENT_METHODS, type SaleRow, type TicketPaymentMethod } from '../lib/types'
import { inventoryStore } from '../store/inventoryStore'
import { useInventory } from '../store/useInventory'

const FILTER_METHODS: TicketPaymentMethod[] = [...PAYMENT_METHODS, 'mixed']

function today() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

type Summary = Awaited<ReturnType<typeof salesSummary>>

export function VentasPage() {
  const { queue, online } = useInventory()
  const [filter, setFilter] = useState<SalesFilter>({ from: today(), to: today(), method: '' })
  const [rows, setRows] = useState<SaleRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pendingSales = queue.flatMap((q) => (q.kind === 'sale' ? [q] : []))
  // Si cambian los filtros mientras carga, solo cuenta la respuesta más reciente.
  const requestId = useRef(0)

  const load = useCallback(async (f: SalesFilter, offset: number) => {
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const [page, sum] = await Promise.all([listSales(f, offset), offset === 0 ? salesSummary(f) : Promise.resolve(null)])
      if (id !== requestId.current) return
      setRows((prev) => (offset === 0 ? page : [...prev, ...page]))
      if (sum) setSummary(sum)
      setHasMore(page.length === SALES_PAGE)
    } catch (e) {
      if (id !== requestId.current) return
      setError(isNetworkError(e) ? 'Sin conexión: no se pueden consultar las ventas.' : (e as Error).message)
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [])

  // Al cambiar filtros (o al sincronizarse ventas pendientes) se recarga.
  useEffect(() => {
    void load(filter, 0)
  }, [filter, load, pendingSales.length])

  const set = (patch: Partial<SalesFilter>) => setFilter((f) => ({ ...f, ...patch }))

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="text-title">Ventas</h1>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="field-label" htmlFor="v-from">Desde</label>
          <input id="v-from" type="date" value={filter.from ?? ''} max={filter.to || undefined} onChange={(e) => set({ from: e.target.value || undefined })} className="field" />
        </div>
        <div>
          <label className="field-label" htmlFor="v-to">Hasta</label>
          <input id="v-to" type="date" value={filter.to ?? ''} min={filter.from || undefined} onChange={(e) => set({ to: e.target.value || undefined })} className="field" />
        </div>
        <div>
          <label className="field-label" htmlFor="v-method">Forma de pago</label>
          <select id="v-method" value={filter.method ?? ''} onChange={(e) => set({ method: e.target.value as TicketPaymentMethod | '' })} className="field cursor-pointer">
            <option value="">Todas</option>
            {FILTER_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => set({ from: today(), to: today() })}>
            Hoy
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => set({ from: undefined, to: undefined })}>
            Todas las fechas
          </button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <div className="card col-span-1 p-4">
            <p className="text-label text-ink-muted">Ventas</p>
            <p className="text-kpi tabular-nums">{formatInt(summary.count)}</p>
          </div>
          <div className="card col-span-1 p-4">
            <p className="text-label text-ink-muted">Total</p>
            <p className="text-kpi tabular-nums">{formatMoney(summary.total)}</p>
          </div>
          {PAYMENT_METHODS.map((m) => (
            <div key={m} className="card p-4">
              <p className="text-label text-ink-muted">{PAYMENT_LABELS[m]}</p>
              <p className="text-heading tabular-nums">{formatMoney(summary.byMethod[m] ?? 0)}</p>
            </div>
          ))}
        </div>
      )}

      {pendingSales.length > 0 && (
        <section className="card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="mr-auto text-heading">Ventas por sincronizar</h2>
            <span className="badge badge-warning">
              {pendingSales.length} pendiente(s){online ? '' : ' · sin conexión'}
            </span>
            {online && (
              <button type="button" onClick={() => void inventoryStore.checkConnection()} className="btn btn-secondary btn-sm">
                <Icon name="refresh" />
                Reintentar ahora
              </button>
            )}
          </div>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-md border border-line">
            {pendingSales.map((q) => (
              <li key={q.opId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="text-ink-muted">{formatDateTime(q.createdAt)}</span>
                <span className="font-medium">Folio pendiente</span>
                <span className="text-ink-muted">{q.sale.customerName ?? 'Sin cliente'}</span>
                <span className="ml-auto">{PAYMENT_LABELS[q.sale.paymentMethod]}</span>
                <span className="font-medium tabular-nums">
                  {formatMoney(q.sale.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <p className="notice bg-danger-bg text-danger-fg">
          <Icon name="alert" className="mt-0.5" />
          {error}
        </p>
      )}

      <SalesTable sales={rows} emptyText={loading ? 'Cargando ventas…' : 'No hay ventas con estos filtros.'} />

      {hasMore && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-caption text-ink-muted">Mostrando {formatInt(rows.length)} ventas</span>
          <button type="button" onClick={() => void load(filter, rows.length)} disabled={loading} className="btn btn-secondary">
            {loading ? 'Cargando…' : 'Cargar más'}
          </button>
        </div>
      )}
    </div>
  )
}
