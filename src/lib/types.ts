export type UserRole = 'admin' | 'staff'

export type MovementType = 'initial_count' | 'scan_add' | 'set_total' | 'adjustment' | 'sale'

export type ScanMode = 'add' | 'set'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: UserRole
}

export interface Product {
  id: string
  barcode: string
  name: string
  category: string | null
  supplier: string | null
  cost: number | null
  price: number
  quantity: number
  /** Ruta dentro del bucket privado `product-images`. */
  image_url: string | null
  is_internal_code: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface MovementResult {
  status: 'ok' | 'duplicate' | 'already_undone'
  movement_id: string
  movement_type: MovementType
  delta: number
  quantity_after: number
  product: Product
}

export type ScanRpcResult = MovementResult | { status: 'not_found'; barcode: string }

export type CreateRpcResult = MovementResult | { status: 'exists'; product: Product }

export interface MovementHistoryRow {
  id: string
  created_at: string
  type: MovementType
  delta: number
  quantity_after: number
  note: string | null
  reverts_movement_id: string | null
  product_id: string
  barcode: string
  product_name: string
  created_by: string | null
  created_by_email: string | null
  created_by_name: string | null
}

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  initial_count: 'Alta / conteo inicial',
  scan_add: 'Escaneo (sumar)',
  set_total: 'Escaneo (fijar total)',
  adjustment: 'Ajuste',
  sale: 'Venta',
}
