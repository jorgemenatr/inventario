/*
 * Categorías de producto. Cada negocio define las suyas (tabla
 * product_categories): categorías principales y, opcionalmente, un nivel de
 * subcategorías. En products.category se guarda el texto: "TCG · Pokémon"
 * para una subcategoría, "Cafetería" para una principal.
 *
 * Se guarda una copia local para tener los menús sin internet.
 */
import { useSyncExternalStore } from 'react'
import sources from './catalogSources.json'
import { supabase } from './supabase'

export const SEP = ' · '

export interface Category {
  id: string
  parent_id: string | null
  name: string
  /** Fuentes del catálogo TCGplayer ligadas (ver catalogSources.json). */
  catalog_sources: string[]
  sort_order: number
}

export interface CategoryNode extends Category {
  /** Texto que se guarda en products.category. */
  value: string
  children: CategoryNode[]
}

export interface Categories {
  /** Principales, cada una con sus subcategorías, en orden de menú. */
  tree: CategoryNode[]
  /** Todos los valores válidos. */
  values: Set<string>
}

// ---------- fuentes del catálogo TCGplayer ----------
export interface CatalogSource {
  key: string
  label: string
  kind: 'juego' | 'accesorio'
}

export const CATALOG_SOURCES: CatalogSource[] = [
  ...Object.entries(sources.juegos).map(([key, s]) => ({ key, label: s.label, kind: 'juego' as const })),
  ...Object.entries(sources.accesorios).map(([key, s]) => ({ key, label: s.label, kind: 'accesorio' as const })),
]

export const catalogSourceLabel = (key: string) => CATALOG_SOURCES.find((s) => s.key === key)?.label ?? key

// ---------- store ----------
const KEY = 'hachiko.categorias'

const bySort = (a: Category, b: Category) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'es-MX')

function build(list: Category[]): Categories {
  const sorted = [...list].sort(bySort)
  const tree: CategoryNode[] = sorted
    .filter((c) => !c.parent_id)
    .map((c) => ({
      ...c,
      value: c.name,
      children: sorted
        .filter((s) => s.parent_id === c.id)
        .map((s) => ({ ...s, value: `${c.name}${SEP}${s.name}`, children: [] })),
    }))
  const values = new Set(tree.flatMap((c) => [c.value, ...c.children.map((s) => s.value)]))
  return { tree, values }
}

function load(): Category[] {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as Category[]) ?? []
  } catch {
    return []
  }
}

let current: Categories = build(load())
const listeners = new Set<() => void>()

export const getCategories = () => current

export function useCategories(): Categories {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getCategories,
  )
}

/** Lee las categorías de la base (después de iniciar sesión y tras cada cambio). */
export async function refreshCategories() {
  const { data, error } = await supabase
    .from('product_categories')
    .select('id, parent_id, name, catalog_sources, sort_order')
  // Sin red, o la base aún no tiene la migración: se queda la copia local.
  if (error || !data) return
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    /* no crítico */
  }
  current = build(data as Category[])
  listeners.forEach((l) => l())
}

// ---------- ayudas ----------
/** Categoría principal de un valor guardado ("TCG · Magic" → "TCG"). */
export function mainCategory(category: string | null | undefined) {
  return category ? category.split(SEP)[0] : null
}

/** ¿El producto cae en el filtro? (una principal incluye sus subcategorías). */
export function matchesCategory(category: string | null | undefined, filter: string) {
  if (!filter) return true
  return category === filter || !!category?.startsWith(`${filter}${SEP}`)
}

/** Categoría sugerida para un producto del catálogo: la que tiene su fuente ligada. */
export function categoryForCatalog(source: string | null | undefined): string {
  if (!source) return ''
  for (const c of current.tree) {
    if (c.catalog_sources.includes(source)) return c.value
    const sub = c.children.find((s) => s.catalog_sources.includes(source))
    if (sub) return sub.value
  }
  return ''
}

// ---------- administración (solo admin; RLS lo exige) ----------
function translate(error: { message?: string; code?: string }): Error {
  const msg = error.message ?? ''
  if (error.code === '23505' && msg.includes('product_categories_name_key')) {
    return new Error('Ya existe una categoría con ese nombre.')
  }
  if (error.code === '23514' || msg.includes('check constraint')) {
    return new Error(`El nombre no puede estar vacío, pasar de 60 letras ni llevar "${SEP.trim()}".`)
  }
  if (error.code === '42501') return new Error('Solo un administrador puede cambiar las categorías.')
  return new Error(msg || 'No se pudo guardar la categoría')
}

async function run(query: PromiseLike<{ error: { message?: string; code?: string } | null }>) {
  const { error } = await query
  if (error) throw translate(error)
  await refreshCategories()
}

export function createCategory(input: { name: string; parent_id: string | null; catalog_sources: string[] }) {
  const siblings = current.tree.flatMap((c) => [c, ...c.children]).filter((c) => c.parent_id === input.parent_id)
  const sort_order = siblings.reduce((m, c) => Math.max(m, c.sort_order), 0) + 1
  return run(supabase.from('product_categories').insert({ ...input, name: input.name.trim(), sort_order }))
}

export function updateCategory(id: string, patch: Partial<Pick<Category, 'name' | 'parent_id' | 'catalog_sources'>>) {
  const p = patch.name === undefined ? patch : { ...patch, name: patch.name.trim() }
  return run(supabase.from('product_categories').update(p).eq('id', id))
}

export function deleteCategory(id: string) {
  return run(supabase.from('product_categories').delete().eq('id', id))
}

/** Sube o baja una categoría entre sus hermanas. */
export async function moveCategory(id: string, dir: -1 | 1) {
  const all = current.tree.flatMap((c) => [c, ...c.children])
  const me = all.find((c) => c.id === id)
  if (!me) return
  const siblings = all.filter((c) => c.parent_id === me.parent_id)
  const i = siblings.findIndex((c) => c.id === id)
  const other = siblings[i + dir]
  if (!other) return
  // Se renumeran todas las hermanas para que no queden empates.
  const order = siblings.map((c) => c.id)
  order[i] = other.id
  order[i + dir] = id
  for (const [n, cid] of order.entries()) {
    const { error } = await supabase.from('product_categories').update({ sort_order: n + 1 }).eq('id', cid)
    if (error) throw translate(error)
  }
  await refreshCategories()
}
