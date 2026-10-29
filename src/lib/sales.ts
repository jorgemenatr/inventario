import { supabase } from './supabase'
import type { PaymentMethod, SaleRow, TicketItemRow, TicketPaymentMethod, TicketPaymentRow } from './types'

export interface SalesFilter {
  /** AAAA-MM-DD (día local, inclusive). */
  from?: string
  to?: string
  method?: TicketPaymentMethod | ''
  customerId?: string
}

const PAGE = 100

/**
 * Folio de una venta ("140"). Las ventas anteriores a la migración
 * nombre_tickets se guardaron como "Ticket 140".
 */
export function ticketFolio(name: string | null | undefined) {
  return (name ?? '').replace(/^Ticket\s+/i, '')
}

/** Título de una venta: "140. Ana Martínez" (o solo "140" si no se muestra el cliente). */
export function saleTitle(sale: { name: string; customer_name: string | null }, withCustomer = true) {
  const folio = ticketFolio(sale.name)
  return withCustomer ? `${folio}. ${sale.customer_name ?? 'Sin cliente'}` : `#${folio}`
}

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

async function fetchAll<T>(build: (from: number) => PromiseLike<{ data: unknown; error: unknown }>) {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from)
    if (error) throw error
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < 1000) break
  }
  return rows
}

/**
 * Totales del filtro (todas las páginas): número de ventas, total y suma por
 * forma de pago. Los pagos mixtos se reparten en sus métodos reales.
 */
export async function salesSummary(filter: SalesFilter) {
  const [tickets, payments] = await Promise.all([
    fetchAll<{ total: number }>((from) =>
      applyFilter(supabase.from('tickets').select('total').order('paid_at', { ascending: false }).range(from, from + 999), filter),
    ),
    fetchAll<{ method: PaymentMethod; amount: number }>((from) =>
      applyFilter(supabase.from('sales_payments').select('method, amount').order('paid_at', { ascending: false }).range(from, from + 999), filter),
    ),
  ])
  const byMethod: Partial<Record<PaymentMethod, number>> = {}
  for (const p of payments) byMethod[p.method] = (byMethod[p.method] ?? 0) + Number(p.amount)
  const total = tickets.reduce((s, t) => s + Number(t.total), 0)
  return { count: tickets.length, total, byMethod }
}

export async function getTicketPayments(ticketId: string): Promise<TicketPaymentRow[]> {
  const { data, error } = await supabase.from('ticket_payments').select('*').eq('ticket_id', ticketId)
  if (error) throw error
  return ((data ?? []) as TicketPaymentRow[]).map((p) => ({ ...p, amount: Number(p.amount) }))
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
