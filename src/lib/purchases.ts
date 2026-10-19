import { supabase } from './supabase'
import type { PurchaseItemRow, PurchaseRow, StockLocation } from './types'

/*
 * Compras (solo admin): cada renglón crea un lote con el proveedor y el costo
 * de la compra, en la ubicación donde llega ("Llega a").
 */

export interface PurchaseInput {
  /** Lo genera la app: si se reintenta, no se duplica. */
  id: string
  supplierId: string
  location: StockLocation
  folio: string
  note: string
  items: { productId: string; quantity: number; unitCost: number }[]
}

const numRow = (p: PurchaseRow): PurchaseRow => ({ ...p, total: Number(p.total) })

export async function registerPurchase(input: PurchaseInput): Promise<void> {
  const { error } = await supabase.rpc('register_purchase', {
    p_purchase_id: input.id,
    p_supplier_id: input.supplierId,
    p_items: input.items.map((i) => ({ product_id: i.productId, quantity: i.quantity, unit_cost: i.unitCost })),
    p_location: input.location,
    p_folio: input.folio.trim() || null,
    p_note: input.note.trim() || null,
  })
  if (error) throw error
}

/** Folio y nota siempre; proveedor y costos solo si la compra está intacta. */
export async function updatePurchase(
  id: string,
  patch: { supplierId: string; folio: string; note: string; costs: { itemId: string; unitCost: number }[] },
): Promise<void> {
  const { error } = await supabase.rpc('update_purchase', {
    p_purchase_id: id,
    p_supplier_id: patch.supplierId,
    p_folio: patch.folio.trim() || null,
    p_note: patch.note.trim() || null,
    p_costs: patch.costs.length ? patch.costs.map((c) => ({ item_id: c.itemId, unit_cost: c.unitCost })) : null,
  })
  if (error) throw error
}

/** Regresa todas las piezas de la compra (solo si está intacta). */
export async function cancelPurchase(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_purchase', { p_purchase_id: id, p_reason: reason.trim() })
  if (error) throw error
}

export async function listPurchases(limit = 100): Promise<PurchaseRow[]> {
  const { data, error } = await supabase
    .from('purchase_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return ((data ?? []) as PurchaseRow[]).map(numRow)
}

export async function getPurchaseItems(purchaseId: string): Promise<PurchaseItemRow[]> {
  const { data, error } = await supabase
    .from('purchase_item_details')
    .select('*')
    .eq('purchase_id', purchaseId)
    .order('position')
  if (error) throw error
  return ((data ?? []) as PurchaseItemRow[]).map((i) => ({ ...i, unit_cost: Number(i.unit_cost), line_total: Number(i.line_total) }))
}
