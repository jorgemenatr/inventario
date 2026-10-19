import { supabase } from './supabase'
import type { StockLocation, TransferLotRow, TransferRow } from './types'

/*
 * Movimiento de bodega (solo admin): mueve piezas entre tienda y bodega.
 * Todo o nada. Bodega → tienda saca primero los lotes más viejos; tienda →
 * bodega, los más nuevos (así no se altera el orden en que se vende).
 */

export interface TransferInput {
  /** Lo genera la app: si se reintenta, no se duplica. */
  id: string
  from: StockLocation
  to: StockLocation
  note: string
  items: { productId: string; quantity: number }[]
}

/** Producto al que no le alcanzó el origen (viene en el DETAIL del error). */
export interface TransferShortage {
  product_id: string
  name: string
  requested: number
  available: number
}

export class TransferStockError extends Error {
  constructor(
    message: string,
    readonly shortages: TransferShortage[],
  ) {
    super(message)
  }
}

export async function createTransfer(input: TransferInput): Promise<void> {
  const { error } = await supabase.rpc('create_transfer', {
    p_transfer_id: input.id,
    p_from: input.from,
    p_to: input.to,
    p_items: input.items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
    p_note: input.note.trim() || null,
  })
  if (!error) return
  if (error.hint === 'insufficient_stock' && error.details) {
    try {
      throw new TransferStockError(error.message, JSON.parse(error.details) as TransferShortage[])
    } catch (e) {
      if (e instanceof TransferStockError) throw e
    }
  }
  throw error
}

export async function listTransfers(limit = 100): Promise<TransferRow[]> {
  const { data, error } = await supabase
    .from('transfer_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as TransferRow[]
}

export async function getTransferLots(transferId: string): Promise<TransferLotRow[]> {
  const { data, error } = await supabase
    .from('transfer_item_lots')
    .select('*')
    .eq('transfer_id', transferId)
    .order('product_name')
    .order('lot_number')
  if (error) throw error
  return ((data ?? []) as TransferLotRow[]).map((r) => ({ ...r, unit_cost: Number(r.unit_cost) }))
}
