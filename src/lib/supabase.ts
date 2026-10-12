import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && anonKey)

// Ninguna petición puede colgarse indefinidamente: si la red se cae a medio
// request, la cola offline necesita enterarse para encolar la operación.
const REQUEST_TIMEOUT_MS = 12_000

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  return fetch(input, { ...init, signal })
}

/** Cliente único de Supabase para toda la app (solo anon key: nunca service_role). */
export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'hachiko.auth',
  },
  global: { fetch: fetchWithTimeout },
})

/** ¿El error se debe a falta de red (y no a una respuesta del servidor)? */
export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  if (!error) return false
  const e = error as { name?: string; message?: string; status?: number; code?: string }
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true
  if (e.name === 'AuthRetryableFetchError') return true
  const msg = `${e.message ?? ''}`.toLowerCase()
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('aborted') ||
    (e.status === 0 && !e.code)
  )
}

/** ¿El error indica que el token expiró o no es válido? */
export function isAuthError(error: unknown): boolean {
  if (!error) return false
  const e = error as { message?: string; status?: number; code?: string }
  const msg = `${e.message ?? ''}`.toLowerCase()
  return e.status === 401 || e.code === 'PGRST301' || e.code === 'PGRST303' || msg.includes('jwt')
}

/**
 * Prueba ligera de conectividad con Supabase (no depende de la sesión).
 * navigator.onLine no basta: puede decir "en línea" sin salida real a internet.
 */
export async function probeConnection(): Promise<boolean> {
  if (!supabaseConfigured) return false
  if (!navigator.onLine) return false
  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anonKey! },
      signal: AbortSignal.timeout(5_000),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}
