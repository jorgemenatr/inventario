export type UserRole = 'admin' | 'mostrador'

export const ROLE_LABELS: Record<UserRole, string> = { admin: 'Administrador', mostrador: 'Mostrador' }

export type MovementType = 'initial_count' | 'scan_add' | 'set_total' | 'adjustment' | 'sale' | 'barcode_unlink'

export type ScanMode = 'add' | 'set'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  created_at?: string
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
  /** Código que tenía el producto (solo en 'barcode_unlink'). */
  old_barcode?: string | null
  /** Si se canceló: el movimiento que lo revirtió, cuándo, quién y la nota con el motivo. */
  cancelled_by_movement_id?: string | null
  cancelled_at?: string | null
  cancel_note?: string | null
  cancelled_by_name?: string | null
}

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  initial_count: 'Alta / conteo inicial',
  scan_add: 'Escaneo (sumar)',
  set_total: 'Escaneo (fijar total)',
  adjustment: 'Ajuste',
  sale: 'Venta',
  barcode_unlink: 'Desvinculado',
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

/** Métodos con los que se puede pagar (uno o varios por ticket). */
export type PaymentMethod = 'cash' | 'card' | 'credit' | 'transfer'
/** Método del ticket: 'mixed' cuando se pagó con más de uno. */
export type TicketPaymentMethod = PaymentMethod | 'mixed'

export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'credit', 'transfer']

export const PAYMENT_LABELS: Record<TicketPaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  credit: 'Créditos',
  transfer: 'Transferencia',
  mixed: 'Mixto',
}

export interface PaymentPart {
  method: PaymentMethod
  amount: number
}

export interface TicketPaymentRow {
  id: string
  ticket_id: string
  method: PaymentMethod
  amount: number
}

/** Saldo de créditos de un cliente (vista customer_credit_balances). */
export interface CreditBalance {
  customer_id: string
  earned: number
  used: number
  balance: number
}

/** Fila de la vista credit_movement_history. */
export interface CreditMovementRow {
  id: string
  customer_id: string
  kind: 'grant' | 'sale'
  amount: number
  note: string | null
  ticket_id: string | null
  ticket_name: string | null
  batch_id: string | null
  created_at: string
  created_by: string | null
  created_by_email: string | null
  created_by_name: string | null
}

/** Ticket cobrado (tabla tickets). */
export interface Ticket {
  id: string
  name: string
  status: 'open' | 'paid'
  customer_id: string | null
  payment_method: TicketPaymentMethod
  item_count: number
  subtotal: number
  total: number
  paid_offline: boolean
  note: string | null
  opened_at: string | null
  paid_at: string
}

/** Fila de la vista sales_history. */
export interface SaleRow extends Ticket {
  customer_name: string | null
  created_by: string | null
  created_by_email: string | null
  created_by_name: string | null
}

export interface TicketItemRow {
  id: string
  ticket_id: string
  product_id: string
  barcode: string
  product_name: string
  quantity: number
  unit_price: number
  line_total: number
  position: number
}

export interface PayTicketResult {
  status: 'ok' | 'duplicate'
  ticket: Ticket
  products: Product[]
}

/** Fila de la vista league_points_history. */
export interface LeaguePointsRow {
  id: string
  customer_id: string
  points: number
  note: string | null
  /** Fecha (YYYY-MM-DD) en que se ganaron. */
  awarded_on: string
  batch_id: string | null
  created_at: string
  created_by: string | null
  created_by_email: string | null
  created_by_name: string | null
}
