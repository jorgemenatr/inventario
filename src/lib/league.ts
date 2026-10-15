import { supabase } from './supabase'
import type { LeaguePointsRow } from './types'

/** Total de puntos de liga de todos los clientes (customer_id → puntos). */
export async function listLeagueTotals(): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('customer_league_totals').select('*').range(from, from + 999)
    if (error) throw error
    for (const r of (data ?? []) as { customer_id: string; points: number }[]) out.set(r.customer_id, Number(r.points))
    if (!data || data.length < 1000) break
  }
  return out
}

export async function listLeagueHistory(customerId: string): Promise<LeaguePointsRow[]> {
  const { data, error } = await supabase
    .from('league_points_history')
    .select('*')
    .eq('customer_id', customerId)
    .order('awarded_on', { ascending: false })
    .order('created_at', { ascending: false })
    .range(0, 499)
  if (error) throw error
  return (data ?? []) as LeaguePointsRow[]
}

export interface LeagueGrant {
  customerId: string
  points: number
}

/**
 * Agrega puntos de liga a uno o varios clientes con la misma fecha y
 * comentario. El id de lote evita duplicar si se reintenta.
 */
export async function grantLeaguePoints(batchId: string, awardedOn: string, note: string, grants: LeagueGrant[]) {
  const { data, error } = await supabase.rpc('grant_league_points', {
    p_batch_id: batchId,
    p_awarded_on: awardedOn,
    p_note: note.trim(),
    p_grants: grants.map((g) => ({ customer_id: g.customerId, points: g.points })),
  })
  if (error) throw error
  return data as { status: 'ok' | 'duplicate'; count: number; total: number }
}

/** Hoy en formato YYYY-MM-DD (hora local). */
export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' })

/** "2026-10-15" → "15 oct 2026" (sin desfase de zona horaria). */
export function formatDay(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return dateFmt.format(new Date(y, m - 1, d))
}

/** "+3", "−2". */
export const formatPoints = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('es-MX')}`
