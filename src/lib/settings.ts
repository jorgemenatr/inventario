/*
 * Configuración del negocio (tabla app_settings, una fila por base).
 * Cada cliente tiene su propio proyecto de Supabase: el nombre que muestra la
 * app y el prefijo de los códigos internos salen de su base, no del código.
 *
 * Se guarda una copia local para tenerla sin internet y antes de iniciar
 * sesión (la pantalla de login no puede leer la base).
 */
import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'

export interface AppSettings {
  businessName: string
  /** Prefijo de los códigos internos: "HCH" → HCH-000001. */
  codePrefix: string
}

const KEY = 'hachiko.ajustes'

const DEFAULTS: AppSettings = {
  // Opcional por sitio: para mostrar el nombre en el login de un equipo nuevo.
  businessName: (import.meta.env.VITE_BUSINESS_NAME as string | undefined)?.trim() ?? '',
  codePrefix: 'HCH',
}

let current: AppSettings = load()
const listeners = new Set<() => void>()
applyTitle()

function load(): AppSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<AppSettings> | null
    return { ...DEFAULTS, ...saved }
  } catch {
    return DEFAULTS
  }
}

function applyTitle() {
  if (typeof document !== 'undefined') document.title = appTitle(current)
}

export function appTitle(s: AppSettings = current) {
  return s.businessName ? `Inventario ${s.businessName}` : 'Inventario'
}

export const getSettings = () => current

export function useSettings(): AppSettings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getSettings,
  )
}

/** Lee la configuración de la base (después de iniciar sesión). */
export async function refreshSettings() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('business_name, internal_code_prefix')
    .maybeSingle()
  // Sin red, o la base aún no tiene la migración: se queda la copia local.
  if (error || !data) return
  const next: AppSettings = { businessName: data.business_name, codePrefix: data.internal_code_prefix }
  if (next.businessName === current.businessName && next.codePrefix === current.codePrefix) return
  current = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* no crítico */
  }
  applyTitle()
  listeners.forEach((l) => l())
}

/** "Inventario Dragón Rojo" → "inventario-dragon-rojo" (para nombres de archivo). */
export function fileSlug(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Nombre de archivo de exportación: "inventario" → "inventario-dragon-rojo". */
export const exportName = (base: string) => fileSlug(`${base} ${current.businessName}`)
