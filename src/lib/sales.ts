import { supabase } from './supabase'
import type { PaymentMethod, SaleRow, TicketItemRow } from './types'

export interface SalesFilter {
  /** AAAA-MM-DD (día local, inclusive). */
  from?: string
  to?: string
  method?: PaymentMethod | ''
  customerId?: string
}

const PAGE = 100

/** Inicio del día local en ISO (para filtrar por fecha en la zona de la tienda). */
function dayStart(date: string) {
  return new Date(`${date}T00:00:00`).toISOString()
}

function applyFilter<T extends { gte: Function; lt: Function; eq: Function }>(query: T, f: SalesFilter): T {
  let q = query
  if (f.from) q = q.gte('paid_at', dayStart(f.from))
  if (f.to) {
    const next = new Date(`${f.to}T00:00:00`)
    next.setDate(next.getDate() + 1)
    q = q.lt('paid_at', next.toISOString())
  }
  if (f.method) q = q.eq('payment_method', f.method)
  if (f.customerId) q = q.eq('customer_id', f.customerId)
  return q
}

export async function listSales(filter: SalesFilter, offset = 0): Promise<SaleRow[]> {
  const query = applyFilter(
    supabase.from('sales_history').select('*').order('paid_at', { ascending: false }).range(offset, offset + PAGE - 1),
    filter,
  )
  const { data, error } = await query
  if (error) throw error
  return ((data ?? []) as SaleRow[]).map((r) => ({ ...r, subtotal: Number(r.subtotal), total: Number(r.total) }))
}

/** Totales del filtro (todas las páginas): número de ventas y suma por forma de pago. */
export async function salesSummary(filter: SalesFilter) {
  const rows: { payment_method: PaymentMethod; total: number }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await applyFilter(
      supabase.from('tickets').select('payment_method, total').order('paid_at', { ascending: false }).range(from, from + 999),
      filter,
    )
    if (error) throw error
    rows.push(...((data ?? []) as typeof rows))
    if (!data || data.length < 1000) break
  }
  const byMethod: Partial<Record<PaymentMethod, number>> = {}
  let total = 0
  for (const r of rows) {
    const t = Number(r.total)
    total += t
    byMethod[r.payment_method] = (byMethod[r.payment_method] ?? 0) + t
  }
  return { count: rows.length, total, byMethod }
}

export async function getTicketItems(ticketId: string): Promise<TicketItemRow[]> {
  const { data, error } = await supabase
    .from('ticket_items')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('position', { ascending: true })
  if (error) throw error
  return ((data ?? []) as TicketItemRow[]).map((i) => ({ ...i, unit_price: Number(i.unit_price), line_total: Number(i.line_total) }))
}

export const SALES_PAGE = PAGE
