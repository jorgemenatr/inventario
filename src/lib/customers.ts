import { supabase } from './supabase'
import type { Customer } from './types'

/** Sugerencias para "Juegos que juega" (se puede escribir cualquier otro). */
export const GAME_OPTIONS = [
  'Pokémon',
  'Magic: The Gathering',
  'Yu-Gi-Oh!',
  'Lorcana',
  'Flesh and Blood',
  'One Piece',
  'Star Wars Unlimited',
  'Digimon',
  'Dragon Ball Super',
  'Riftbound',
  'Gundam',
  'Weiss Schwarz',
]

export interface CustomerInput {
  name: string
  email: string | null
  phone: string | null
  games: string[]
}

const COLUMNS = 'id, name, email, phone, games, created_at, updated_at'
const PAGE = 1000

/** Limpia y valida antes de guardar. Devuelve un mensaje si algo está mal. */
export function validateCustomer(input: CustomerInput): string | null {
  if (!input.name.trim()) return 'El nombre es obligatorio.'
  const email = input.email?.trim()
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'El correo no parece válido.'
  return null
}

function clean(input: CustomerInput) {
  const games = [...new Set(input.games.map((g) => g.trim()).filter(Boolean))]
  return {
    name: input.name.trim(),
    email: input.email?.trim().toLowerCase() || null,
    phone: input.phone?.trim() || null,
    games,
  }
}

export async function listCustomers(): Promise<Customer[]> {
  const all: Customer[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('customers')
      .select(COLUMNS)
      .order('name', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...((data ?? []) as Customer[]))
    if (!data || data.length < PAGE) break
  }
  return all
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const { data, error } = await supabase.from('customers').select(COLUMNS).eq('id', id).maybeSingle()
  if (error) throw error
  return data as Customer | null
}

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  const { data, error } = await supabase.from('customers').insert(clean(input)).select(COLUMNS).single()
  if (error) throw error
  return data as Customer
}

export async function updateCustomer(id: string, input: CustomerInput): Promise<Customer> {
  const { data, error } = await supabase.from('customers').update(clean(input)).eq('id', id).select(COLUMNS).single()
  if (error) throw error
  return data as Customer
}

/** Todos los juegos usados por algún cliente + las sugerencias fijas, sin repetir. */
export function gameSuggestions(customers: Customer[]) {
  const seen = new Map<string, string>()
  for (const g of [...GAME_OPTIONS, ...customers.flatMap((c) => c.games)]) {
    const key = g.toLowerCase()
    if (!seen.has(key)) seen.set(key, g)
  }
  return [...seen.values()]
}
