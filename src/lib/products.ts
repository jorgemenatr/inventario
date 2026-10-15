import { uploadProductImage } from './images'
import { supabase } from './supabase'
import type { Product } from './types'

export interface ProductPatch {
  name: string
  price: number
  cost: number | null
  category: string | null
  supplier: string | null
  description: string | null
}

const COLUMNS =
  'id, barcode, name, category, supplier, cost, price, quantity, image_url, is_internal_code, description, catalog_product_id, created_by, created_at, updated_at'

const num = (p: Product): Product => ({ ...p, price: Number(p.price), cost: p.cost == null ? null : Number(p.cost) })

export async function getProduct(id: string): Promise<Product | null> {
  const { data, error } = await supabase.from('products').select(COLUMNS).eq('id', id).maybeSingle()
  if (error) throw error
  return data ? num(data as Product) : null
}

/**
 * Edita los datos del producto (no la cantidad: esa cambia con movimientos).
 * image: Blob = foto nueva, null = quitar la foto, undefined = no tocarla.
 */
export async function updateProduct(id: string, patch: ProductPatch, image?: Blob | null): Promise<Product> {
  const row: Partial<Product> = {
    name: patch.name.trim(),
    price: patch.price,
    cost: patch.cost,
    category: patch.category?.trim() || null,
    supplier: patch.supplier?.trim() || null,
    description: patch.description?.trim() || null,
  }
  if (image === null) row.image_url = null
  else if (image) row.image_url = await uploadProductImage(image)
  const { data, error } = await supabase.from('products').update(row).eq('id', id).select(COLUMNS).single()
  if (error) throw error
  return num(data as Product)
}
