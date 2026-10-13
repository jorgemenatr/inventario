import { supabase } from './supabase'
import type { CreditBalance, CreditMovementRow } from './types'

const num = (v: unknown) => Number(v ?? 0)

/** Saldo de créditos de todos los clientes (customer_id → saldo). */
export async function listCreditBalances(): Promise<Map<string, CreditBalance>> {
  const out = new Map<string, CreditBalance>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('customer_credit_balances').select('*').range(from, from + 999)
    if (error) throw error
    for (const r of (data ?? []) as CreditBalance[]) {
      out.set(r.customer_id, { ...r, earned: num(r.earned), used: num(r.used), balance: num(r.balance) })
    }
    if (!data || data.length < 1000) break
  }
  return out
}

export async function getCreditBalance(customerId: string): Promise<CreditBalance> {
  const { data, error } = await supabase.from('customer_credit_balances').select('*').eq('customer_id', customerId).maybeSingle()
  if (error) throw error
  const r = data as CreditBalance | null
  return { customer_id: customerId, earned: num(r?.earned), used: num(r?.used), balance: num(r?.balance) }
}

export async function listCreditHistory(customerId: string): Promise<CreditMovementRow[]> {
  const { data, error } = await supabase
    .from('credit_movement_history')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .range(0, 499)
  if (error) throw error
  return ((data ?? []) as CreditMovementRow[]).map((m) => ({ ...m, amount: num(m.amount) }))
}

export interface CreditGrant {
  customerId: string
  amount: number
}

/**
 * Agrega créditos a uno o varios clientes con el mismo concepto. El id de lote
 * evita duplicar si se reintenta (p. ej. doble clic o red lenta).
 */
export async function grantCredits(batchId: string, note: string, grants: CreditGrant[]) {
  const { data, error } = await supabase.rpc('grant_credits', {
    p_batch_id: batchId,
    p_note: note.trim(),
    p_grants: grants.map((g) => ({ customer_id: g.customerId, amount: g.amount })),
  })
  if (error) throw error
  return data as { status: 'ok' | 'duplicate'; count: number; total: number }
}
