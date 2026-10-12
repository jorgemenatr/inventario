import { supabase } from './supabase'
import { compressImage } from './images'
import type { CatalogItem } from './types'

/** Busca en el catálogo TCG por palabras ("delta etb") o por código de barras. */
export async function searchCatalog(query: string, limit = 25): Promise<CatalogItem[]> {
  const { data, error } = await supabase.rpc('search_catalog', { p_query: query, p_limit: limit })
  if (error) throw error
  return ((data ?? []) as CatalogItem[]).map((c) => ({
    ...c,
    market_price: c.market_price == null ? null : Number(c.market_price),
  }))
}

export interface CatalogStatus {
  products: number
  imported_at: string | null
}

let statusCache: Promise<CatalogStatus | null> | null = null

/** Cuántos productos hay en el catálogo y cuándo se importaron (se pide una vez por sesión). */
export function getCatalogStatus(): Promise<CatalogStatus | null> {
  statusCache ??= Promise.resolve(supabase.rpc('catalog_status')).then(({ data, error }) => {
    if (error) {
      statusCache = null
      return null
    }
    return data as CatalogStatus
  })
  return statusCache
}

/** Miniatura ligera para la lista de resultados (el CDN sirve 200 px). */
export function catalogThumb(url: string | null) {
  return url ? url.replace(/_in_1000x1000\.jpg$/, '_200w.jpg') : null
}

/**
 * Descarga la foto del catálogo (el CDN de TCGplayer permite CORS) y la
 * comprime igual que una foto propia, para guardarla en nuestro bucket.
 */
export async function fetchCatalogImage(url: string): Promise<Blob> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return compressImage(await res.blob())
}
