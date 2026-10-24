/*
 * ¿De qué cliente es este sitio? Un solo sitio atiende a todos los clientes:
 * el subdominio (hachiko.kananpos.com) dice a qué proyecto de Supabase
 * conectarse, según el registro src/tenants.json.
 *
 * Fuera del dominio (localhost, *.netlify.app, deploy previews) se usan las
 * variables de entorno VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, como antes.
 * En local, VITE_TENANT=<subdominio> simula estar en ese cliente.
 *
 * Todo es síncrono (el registro va dentro del build): la app arranca igual
 * sin internet.
 */
import registry from '../tenants.json'

export type TenantStatus = 'activo' | 'suspendido'

export interface Tenant {
  /** Subdominio ("hachiko"); vacío cuando viene de las variables de entorno. */
  slug: string
  name: string
  supabaseUrl: string
  anonKey: string
  status: TenantStatus
}

export type TenantResolution =
  | { kind: 'tenant'; tenant: Tenant }
  /** Dominio principal (kananpos.com / www): no es ningún cliente. */
  | { kind: 'landing' }
  /** Subdominio que no está en el registro. */
  | { kind: 'unknown'; slug: string }
  /** Fuera del dominio y sin variables de entorno. */
  | { kind: 'unconfigured' }

interface Entry {
  nombre: string
  supabase_url: string
  anon_key: string
  estado: string
}

const BASE = registry.dominio_base.toLowerCase()
const CLIENTS = registry.clientes as Record<string, Entry>

function fromEntry(slug: string, e: Entry): Tenant {
  return {
    slug,
    name: e.nombre,
    supabaseUrl: e.supabase_url,
    anonKey: e.anon_key,
    status: e.estado === 'suspendido' ? 'suspendido' : 'activo',
  }
}

function lookup(slug: string): TenantResolution {
  const e = CLIENTS[slug]
  return e ? { kind: 'tenant', tenant: fromEntry(slug, e) } : { kind: 'unknown', slug }
}

export function resolveTenant(
  hostname: string,
  env: { tenant?: string; url?: string; anonKey?: string; name?: string } = {},
): TenantResolution {
  if (env.tenant) return lookup(env.tenant.trim().toLowerCase())

  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (host === BASE || host === `www.${BASE}`) return { kind: 'landing' }
  if (host.endsWith(`.${BASE}`)) {
    const slug = host.slice(0, -(BASE.length + 1))
    return slug.includes('.') ? { kind: 'unknown', slug } : lookup(slug)
  }

  if (!env.url || !env.anonKey) return { kind: 'unconfigured' }
  return {
    kind: 'tenant',
    tenant: { slug: '', name: env.name?.trim() ?? '', supabaseUrl: env.url, anonKey: env.anonKey, status: 'activo' },
  }
}

/** Resolución de este sitio (se calcula una vez al cargar). */
export const current: TenantResolution = resolveTenant(typeof location === 'undefined' ? '' : location.hostname, {
  tenant: import.meta.env.VITE_TENANT as string | undefined,
  url: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
  name: import.meta.env.VITE_BUSINESS_NAME as string | undefined,
})

/** El cliente de este sitio, si se puede usar la app (existe y no está suspendido). */
export const activeTenant: Tenant | null =
  current.kind === 'tenant' && current.tenant.status === 'activo' ? current.tenant : null

export const baseDomain = BASE
