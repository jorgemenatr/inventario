import { useCallback, useEffect, useState } from 'react'
import { buildMovementRows, exportCsv, exportXlsx } from '../lib/export'
import { formatDateTime, formatInt } from '../lib/format'
import { isNetworkError, supabase } from '../lib/supabase'
import { Icon } from '../components/Icon'
import { MOVEMENT_LABELS, type MovementHistoryRow } from '../lib/types'
import { inventoryStore, type QueueItem } from '../store/inventoryStore'
import { useInventory } from '../store/useInventory'

const PAGE = 100

function describeQueueItem(item: QueueItem) {
  switch (item.kind) {
    case 'create':
      return `Alta: ${item.input.name} (${item.input.barcode ?? 'HCH-'})`
    case 'scan':
      return `Escaneo ${item.barcode} (${item.mode === 'add' ? '+' : '='}${item.quantity})`
    case 'sale':
      return `Venta: ${item.sale.name} (${item.sale.items.reduce((n, i) => n + i.quantity, 0)} pzas)`
    default:
      return `Deshacer ${item.barcode}`
  }
}

export function HistoryPage() {
  const { queue, failed, online } = useInventory()
  const [rows, setRows] = useState<MovementHistoryRow[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async (offset: number, search: string) => {
    setLoading(true)
    setError(null)
    let query = supabase
      .from('movement_history')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE - 1)
    const s = search.trim().replace(/[%,()]/g, '')
    if (s) query = query.or(`barcode.ilike.%${s}%,product_name.ilike.%${s}%`)
    const { data, error } = await query
    setLoading(false)
    if (error) {
      setError(isNetworkError(error) ? 'Sin conexión: no se puede cargar el historial.' : error.message)
      return
    }
    const page = (data ?? []) as MovementHistoryRow[]
    setRows((prev) => (offset === 0 ? page : [...prev, ...page]))
    setHasMore(page.length === PAGE)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void load(0, filter), 300)
    return () => clearTimeout(t)
  }, [filter, load])

  async function doExport(kind: 'csv' | 'xlsx') {
    setExporting(true)
    try {
      const data = await buildMovementRows()
      if (kind === 'csv') exportCsv(data, 'movimientos-hachiko')
      else await exportXlsx(data, 'movimientos-hachiko', 'Movimientos')
    } catch (e) {
      setError(`No se pudo exportar: ${(e as Error).message}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-title">Historial de movimientos</h1>
        <button type="button" onClick={() => void doExport('csv')} disabled={exporting || !online} className="btn btn-secondary">
          <Icon name="download" />
          Exportar CSV
        </button>
        <button type="button" onClick={() => void doExport('xlsx')} disabled={exporting || !online} className="btn btn-secondary">
          <Icon name="download" />
          {exporting ? 'Exportando…' : 'Exportar Excel'}
        </button>
      </div>

      {(queue.length > 0 || failed.length > 0) && (
        <section className="card p-5">
          <h2 className="text-heading">Operaciones locales</h2>
          {queue.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="badge badge-warning">
                {queue.length} pendiente(s) por sincronizar{online ? '' : ' (sin conexión)'}
              </span>
              <button type="button" onClick={() => void inventoryStore.checkConnection()} className="btn btn-secondary btn-sm">
                <Icon name="refresh" />
                Reintentar ahora
              </button>
            </div>
          )}
          {failed.length > 0 && (
            <div className="mt-4">
              <p className="text-ink-muted">
                Operaciones que el servidor rechazó. Revísalas y corrige a mano si hace falta.
              </p>
              <ul className="mt-3 divide-y divide-line overflow-hidden rounded-md border border-line">
                {failed.map((f, i) => (
                  <li key={f.item.opId} className="flex items-center gap-3 px-4 py-3">
                    <span className="badge badge-danger">Rechazada</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-ink">
                        {describeQueueItem(f.item)}
                      </p>
                      <p className="text-danger-fg">{f.error}</p>
                      <p className="text-caption text-ink-subtle">{formatDateTime(f.item.createdAt)}</p>
                    </div>
                    <button type="button" onClick={() => inventoryStore.dismissFailed(i)} className="btn btn-ghost btn-sm">
                      Descartar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <label className="flex h-control-md w-full max-w-sm items-center gap-2 rounded-md border border-control bg-surface px-3 text-ink-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring">
        <Icon name="search" />
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Buscar por código o nombre"
          aria-label="Buscar por código o nombre"
          className="min-w-0 flex-1 bg-transparent text-ink outline-none focus-visible:outline-none"
        />
      </label>

      {error && (
        <p className="notice bg-danger-bg text-danger-fg">
          <Icon name="alert" className="mt-0.5" />
          {error}
        </p>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-subtle text-label whitespace-nowrap text-ink-muted">
              <th className="h-control-md px-4 font-medium">Fecha</th>
              <th className="h-control-md px-4 font-medium">Código</th>
              <th className="h-control-md px-4 font-medium">Producto</th>
              <th className="h-control-md px-4 font-medium">Tipo</th>
              <th className="h-control-md px-4 text-right font-medium">Cambio</th>
              <th className="h-control-md px-4 text-right font-medium">Cantidad</th>
              <th className="h-control-md px-4 font-medium">Usuario</th>
              <th className="h-control-md px-4 font-medium">Nota</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-t border-line hover:bg-subtle">
                <td className="h-row px-4 whitespace-nowrap text-ink-muted">{formatDateTime(m.created_at)}</td>
                <td className="h-row px-4 font-mono text-[13px] text-ink-muted">{m.barcode}</td>
                <td className="h-row px-4 font-medium">{m.product_name}</td>
                <td className="h-row px-4 whitespace-nowrap">{MOVEMENT_LABELS[m.type]}</td>
                <td className={`h-row px-4 text-right font-medium tabular-nums ${m.delta > 0 ? 'text-success-fg' : m.delta < 0 ? 'text-danger-fg' : ''}`}>
                  {m.delta > 0 ? '+' : ''}
                  {formatInt(m.delta)}
                </td>
                <td className="h-row px-4 text-right tabular-nums">{formatInt(m.quantity_after)}</td>
                <td className="h-row px-4">{m.created_by_name || m.created_by_email || '—'}</td>
                <td className="h-row px-4 text-ink-muted">{m.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 && !error && <p className="px-4 py-10 text-center text-ink-subtle">Sin movimientos.</p>}
      </div>
      {hasMore && rows.length > 0 && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-caption text-ink-muted">Mostrando {formatInt(rows.length)} movimientos</span>
          <button type="button" onClick={() => void load(rows.length, filter)} disabled={loading} className="btn btn-secondary">
            {loading ? 'Cargando…' : 'Cargar más'}
          </button>
        </div>
      )}
    </div>
  )
}
