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
  code: string | null
  games: string[]
}

const COLUMNS = 'id, name, email, phone, code, games, created_at, updated_at'

/** Código de cliente: 8 dígitos y siempre empieza con 1. */
export const CUSTOMER_CODE_RE = /^1\d{7}$/
const FIRST_CODE = 10000001
const LAST_CODE = 19999999

export const isCustomerCode = (s: string) => CUSTOMER_CODE_RE.test(s.trim())
const PAGE = 1000

/** Limpia y valida antes de guardar. Devuelve un mensaje si algo está mal. */
export function validateCustomer(input: CustomerInput): string | null {
  if (!input.name.trim()) return 'El nombre es obligatorio.'
  const email = input.email?.trim()
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'El correo no parece válido.'
  const code = input.code?.trim()
  if (code) {
    if (!CUSTOMER_CODE_RE.test(code)) return 'El código de cliente debe tener 8 dígitos y empezar con 1.'
    if (!email || !input.phone?.trim()) return 'Para vincular un código de cliente, llena correo y teléfono.'
  }
  return null
}

function clean(input: CustomerInput) {
  const games = [...new Set(input.games.map((g) => g.trim()).filter(Boolean))]
  return {
    name: input.name.trim(),
    email: input.email?.trim().toLowerCase() || null,
    phone: input.phone?.trim() || null,
    code: input.code?.trim() || null,
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

/** Mensaje entendible para los errores de la base al guardar. */
function saveError(error: { code?: string; message: string }) {
  if (error.code === '23505' && error.message.includes('customers_code_key')) return new Error('Ese código ya está vinculado a otro cliente.')
  if (error.code === '23514' && error.message.includes('customers_code_contact'))
    return new Error('Para vincular un código de cliente, llena correo y teléfono.')
  return error
}

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  const { data, error } = await supabase.from('customers').insert(clean(input)).select(COLUMNS).single()
  if (error) throw saveError(error)
  return data as Customer
}

export async function updateCustomer(id: string, input: CustomerInput): Promise<Customer> {
  const { data, error } = await supabase.from('customers').update(clean(input)).eq('id', id).select(COLUMNS).single()
  if (error) throw saveError(error)
  return data as Customer
}

/** Siguiente código libre (el mayor asignado + 1, empezando en 10000001). */
export async function nextCustomerCode(): Promise<string> {
  const { data, error } = await supabase
    .from('customers')
    .select('code')
    .not('code', 'is', null)
    .order('code', { ascending: false })
    .limit(1)
  if (error) throw error
  // Todos tienen 8 dígitos, así que el orden de texto es el numérico.
  const last = (data ?? []).map((r) => Number(r.code)).find((n) => Number.isFinite(n) && n > 0)
  const next = last ? last + 1 : FIRST_CODE
  if (next > LAST_CODE) throw new Error('Ya no hay códigos de cliente disponibles.')
  return String(next)
}

/** Cliente con ese código (exacto), si hay. */
export function findByCode(customers: Customer[], raw: string) {
  const code = raw.trim()
  return isCustomerCode(code) ? customers.find((c) => c.code === code) : undefined
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
