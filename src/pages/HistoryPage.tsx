import { useCallback, useEffect, useState } from 'react'
import { buildMovementRows, exportCsv, exportXlsx } from '../lib/export'
import { formatDateTime, formatInt } from '../lib/format'
import { isNetworkError, supabase } from '../lib/supabase'
import { MOVEMENT_LABELS, type MovementHistoryRow } from '../lib/types'
import { inventoryStore } from '../store/inventoryStore'
import { useInventory } from '../store/useInventory'

const PAGE = 100

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

  const btn = 'rounded-xl px-5 py-3 text-lg font-black disabled:opacity-40'

  return (
    <div className="space-y-5 p-5">
      {(queue.length > 0 || failed.length > 0) && (
        <section className="rounded-2xl bg-white p-5 shadow">
          <h2 className="text-2xl font-black">Operaciones locales</h2>
          {queue.length > 0 && (
            <div className="mt-3">
              <p className="text-lg font-bold text-amber-800">
                {queue.length} pendiente(s) por sincronizar{online ? '' : ' (sin conexión)'}
              </p>
              <button type="button" onClick={() => void inventoryStore.checkConnection()} className={`${btn} mt-2 bg-amber-400`}>
                Reintentar ahora
              </button>
            </div>
          )}
          {failed.length > 0 && (
            <div className="mt-4">
              <p className="text-lg font-bold text-red-800">
                Operaciones que el servidor rechazó (revisa y corrige a mano si hace falta):
              </p>
              <ul className="mt-2 space-y-2">
                {failed.map((f, i) => (
                  <li key={f.item.opId} className="flex items-center gap-3 rounded-lg border-2 border-red-300 bg-red-50 p-3">
                    <div className="flex-1">
                      <p className="font-mono font-bold">
                        {f.item.kind === 'create' ? `Alta: ${f.item.input.name} (${f.item.input.barcode ?? 'HCH-'})` : f.item.kind === 'scan' ? `Escaneo ${f.item.barcode} (${f.item.mode === 'add' ? '+' : '='}${f.item.quantity})` : `Deshacer ${f.item.barcode}`}
                      </p>
                      <p className="text-red-800">{f.error}</p>
                      <p className="text-sm text-slate-600">{formatDateTime(f.item.createdAt)}</p>
                    </div>
                    <button type="button" onClick={() => inventoryStore.dismissFailed(i)} className="rounded-lg bg-slate-200 px-3 py-2 font-bold">
                      Descartar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="rounded-2xl bg-white p-5 shadow">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-3xl font-black">Historial de movimientos</h1>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Buscar por código o nombre…"
            className="w-80 rounded-xl border-4 border-slate-400 px-4 py-2 text-lg focus:border-blue-600 focus:outline-none"
          />
          <button type="button" onClick={() => void doExport('csv')} disabled={exporting || !online} className={`${btn} bg-white ring-4 ring-slate-900`}>
            Exportar CSV
          </button>
          <button type="button" onClick={() => void doExport('xlsx')} disabled={exporting || !online} className={`${btn} bg-emerald-700 text-white`}>
            {exporting ? 'Exportando…' : 'Exportar Excel'}
          </button>
        </div>

        {error && <p className="mb-3 rounded-lg bg-red-100 p-3 text-lg font-bold text-red-800">{error}</p>}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-lg">
            <thead className="border-b-4 border-slate-900 text-base uppercase">
              <tr>
                <th className="p-2">Fecha</th>
                <th className="p-2">Código</th>
                <th className="p-2">Producto</th>
                <th className="p-2">Tipo</th>
                <th className="p-2 text-right">Cambio</th>
                <th className="p-2 text-right">Cantidad</th>
                <th className="p-2">Usuario</th>
                <th className="p-2">Nota</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-b border-slate-200 odd:bg-slate-50">
                  <td className="whitespace-nowrap p-2">{formatDateTime(m.created_at)}</td>
                  <td className="p-2 font-mono">{m.barcode}</td>
                  <td className="p-2 font-semibold">{m.product_name}</td>
                  <td className="p-2">{MOVEMENT_LABELS[m.type]}</td>
                  <td className={`p-2 text-right font-black ${m.delta > 0 ? 'text-emerald-700' : m.delta < 0 ? 'text-red-700' : ''}`}>
                    {m.delta > 0 ? '+' : ''}
                    {formatInt(m.delta)}
                  </td>
                  <td className="p-2 text-right font-bold">{formatInt(m.quantity_after)}</td>
                  <td className="p-2 text-base">{m.created_by_name || m.created_by_email || '—'}</td>
                  <td className="p-2 text-base text-slate-600">{m.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && rows.length === 0 && !error && <p className="p-4 text-lg text-slate-500">Sin movimientos.</p>}
        {hasMore && rows.length > 0 && (
          <button type="button" onClick={() => void load(rows.length, filter)} disabled={loading} className={`${btn} mt-4 bg-slate-200`}>
            {loading ? 'Cargando…' : 'Cargar más'}
          </button>
        )}
      </section>
    </div>
  )
}
