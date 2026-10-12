import { supabase } from './supabase'

const BUCKET = 'product-images'
const MAX_SIDE = 800
const QUALITY = 0.82

/** Redimensiona (máx. 800px por lado) y comprime a JPEG en el navegador. */
export async function compressImage(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo procesar la imagen')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo comprimir la imagen'))), 'image/jpeg', QUALITY),
  )
}

/** Sube la imagen al bucket privado y devuelve su ruta (lo que se guarda en products.image_url). */
export async function uploadProductImage(image: Blob): Promise<string> {
  const path = `products/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from(BUCKET).upload(path, image, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (error) throw error
  return path
}

// Caché de URLs firmadas para no pedirlas en cada render.
const signedCache = new Map<string, { url: string; expires: number }>()
const DISPLAY_TTL_S = 60 * 60

export async function getSignedImageUrl(path: string): Promise<string | null> {
  const cached = signedCache.get(path)
  if (cached && cached.expires > Date.now() + 60_000) return cached.url
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, DISPLAY_TTL_S)
  if (error || !data) return null
  signedCache.set(path, { url: data.signedUrl, expires: Date.now() + DISPLAY_TTL_S * 1000 })
  return data.signedUrl
}

/** URLs firmadas de larga duración para exportar (por defecto 7 días). */
export async function getSignedUrlsForExport(paths: string[], ttlSeconds = 7 * 24 * 60 * 60) {
  const result = new Map<string, string>()
  const unique = [...new Set(paths.filter(Boolean))]
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500)
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(chunk, ttlSeconds)
    if (error) throw error
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) result.set(item.path, item.signedUrl)
    }
  }
  return result
}
