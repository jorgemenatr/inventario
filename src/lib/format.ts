const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const int = new Intl.NumberFormat('es-MX')
const dateTime = new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'medium' })

export const formatMoney = (n: number | null | undefined) => (n == null ? '—' : money.format(n))
export const formatInt = (n: number) => int.format(n)
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso))

/** Acepta "120", "120.50" o "120,50". Devuelve null si está vacío; NaN si es inválido. */
export function parseMoney(text: string): number | null {
  const t = text.trim().replace(/\$/g, '').replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN
}

/** Entero >= min. Devuelve NaN si es inválido. */
export function parseCount(text: string, min = 0): number {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return NaN
  const n = Number(t)
  return n >= min && n <= 1_000_000 ? n : NaN
}
