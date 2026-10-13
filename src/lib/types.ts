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
  description: string | null
  /** productId de TCGplayer (fila de catalog_products) con el que se vinculó. */
  catalog_product_id: number | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Fila de search_catalog (catálogo de producto sellado importado de TCGplayer). */
export interface CatalogItem {
  id: number
  game: string
  set_name: string | null
  set_code: string | null
  name: string
  description: string | null
  image_url: string | null
  upc: string | null
  market_price: number | null
  released_on: string | null
  tcgplayer_url: string | null
  /** El código escaneado coincide con el UPC del catálogo. */
  upc_match: boolean
  /** Producto de inventario ya vinculado a esta fila (si hay). */
  linked_barcode: string | null
  linked_name: string | null
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

export interface Customer {
  id: string
  name: string
  email: string | null
  phone: string | null
  /** Juegos que juega (tags). */
  games: string[]
  created_at: string
  updated_at: string
}
