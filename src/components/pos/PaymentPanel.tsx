import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { getCreditBalance } from '../../lib/credits'
import { formatInt, formatMoney, parseMoney } from '../../lib/format'
import { PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod, type PaymentPart } from '../../lib/types'
import { Icon } from '../Icon'

interface Props {
  total: number
  pieces: number
  hasLines: boolean
  customer: { id: string; name: string } | null
  online: boolean
  paying: boolean
  onPay: (payments: PaymentPart[], change: number | null) => void
  /**
   * Pago parcial (preventa): se cobra un monto entre min y max en lugar del
   * total. El monto empieza en `initial`.
   */
  partial?: { min: number; max: number; initial: number; label: string }
  /** Se ofrece pagar con créditos (las preventas lo pueden tener apagado). */
  allowCredit?: boolean
  /** Texto del botón (recibe el monto a cobrar). */
  actionLabel?: (amount: number) => string
  /** Se muestra arriba del botón (p. ej. "Entregar al liquidar"). */
  footer?: ReactNode
  /** Título del recuadro del total ("Total", "Saldo"). */
  title?: string
}

interface Part {
  method: PaymentMethod
  amount: string
}

const cents = (n: number) => Math.round(n * 100)
const toText = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
const value = (text: string) => {
  const n = parseMoney(text)
  return n === null || Number.isNaN(n) ? 0 : n
}

/**
 * Cobro del ticket: uno o varios métodos de pago que deben sumar el total.
 * - Un método: cubre el total solo (un clic y "Cobrar").
 * - Varios: cada uno con su monto; el nuevo toma lo que falta.
 * - Créditos: necesita cliente y conexión; se muestra y se respeta su saldo.
 * - Efectivo: "Recibido" calcula el cambio.
 */
export function PaymentPanel({
  total: ticketTotal,
  pieces,
  hasLines,
  customer,
  online,
  paying,
  onPay,
  partial,
  allowCredit = true,
  actionLabel,
  footer,
  title = 'Total',
}: Props) {
  const [chargeText, setChargeText] = useState(() => (partial ? toText(partial.initial) : ''))
  const chargeValue = partial ? value(chargeText) : ticketTotal
  // Lo que se cobra ahora: el total del ticket o el abono.
  const total = partial ? Math.max(0, chargeValue) : ticketTotal
  const chargeProblem = !partial
    ? null
    : cents(chargeValue) <= 0
      ? 'Escribe el monto.'
      : cents(chargeValue) < cents(partial.min)
        ? `El mínimo es ${formatMoney(partial.min)}.`
        : cents(chargeValue) > cents(partial.max)
          ? `El máximo es ${formatMoney(partial.max)}.`
          : null
  const methods = allowCredit ? PAYMENT_METHODS : PAYMENT_METHODS.filter((m) => m !== 'credit')
  const [parts, setParts] = useState<Part[]>([])
  const [received, setReceived] = useState('')
  const [credit, setCredit] = useState<{ customerId: string; balance: number | null; error: string | null } | null>(null)

  const single = parts.length === 1
  // Con un solo método, su monto siempre es el total del ticket.
  const amounts = parts.map((p) => (single ? total : value(p.amount)))
  const paid = amounts.reduce((s, a) => s + a, 0)
  const remaining = cents(total) - cents(paid)

  const creditIdx = parts.findIndex((p) => p.method === 'credit')
  const creditAmount = creditIdx >= 0 ? amounts[creditIdx] : 0
  const cashIdx = parts.findIndex((p) => p.method === 'cash')
  const cashAmount = cashIdx >= 0 ? amounts[cashIdx] : 0

  // Saldo de créditos del cliente del ticket (cuando se elige pagar con créditos).
  useEffect(() => {
    if (creditIdx < 0 || !customer || !online) return
    if (credit?.customerId === customer.id && credit.balance !== null) return
    let current = true
    setCredit({ customerId: customer.id, balance: null, error: null })
    getCreditBalance(customer.id)
      .then((b) => current && setCredit({ customerId: customer.id, balance: b.balance, error: null }))
      .catch((e) => current && setCredit({ customerId: customer.id, balance: null, error: (e as Error).message }))
    return () => {
      current = false
    }
  }, [creditIdx, customer, online])

  const creditBalance = credit && customer && credit.customerId === customer.id ? credit.balance : null

  const creditProblem = useMemo(() => {
    if (creditIdx < 0) return null
    if (!customer) return 'Asigna un cliente al ticket para pagar con sus créditos.'
    if (!online) return 'Pagar con créditos necesita conexión.'
    if (credit?.error) return `No se pudo consultar el saldo: ${credit.error}`
    if (creditBalance === null) return null // cargando
    if (creditBalance <= 0) return `${customer.name} no tiene créditos disponibles.`
    if (cents(creditAmount) > cents(creditBalance)) return `${customer.name} solo tiene ${formatMoney(creditBalance)} en créditos.`
    return null
  }, [creditIdx, customer, online, credit, creditBalance, creditAmount])

  const cash = parseMoney(received)
  const change = cashIdx >= 0 && cash !== null && !Number.isNaN(cash) ? cash - cashAmount : null
  const cashShort = change !== null && change < -0.004

  /** Con exactamente dos métodos, el otro se ajusta para completar el total. */
  function withAmount(list: Part[], i: number, amount: number): Part[] {
    const next = list.map((p, j) => (j === i ? { ...p, amount: toText(amount) } : p))
    if (next.length === 2) {
      const other = 1 - i
      next[other] = { ...next[other], amount: toText(Math.max(0, (cents(total) - cents(amount)) / 100)) }
    }
    return next
  }

  function toggle(method: PaymentMethod) {
    const idx = parts.findIndex((p) => p.method === method)
    if (idx >= 0) {
      const next = parts.filter((_, i) => i !== idx)
      // Si queda uno solo, vuelve a cubrir el total.
      setParts(next.length === 1 ? [{ ...next[0], amount: toText(total) }] : next)
      if (method === 'cash') setReceived('')
      return
    }
    if (parts.length === 0) {
      setParts([{ method, amount: toText(total) }])
      return
    }
    // Al pasar de uno a varios, el primero conserva su monto como editable.
    const current = single ? [{ ...parts[0], amount: toText(total) }] : parts
    const rem = Math.max(0, (cents(total) - cents(current.reduce((s, p) => s + value(p.amount), 0))) / 100)
    const list = [...current, { method, amount: toText(rem) }]
    // Con créditos y otro método (en cualquier orden): créditos usa el saldo
    // disponible y el otro método paga el resto.
    const ci = list.findIndex((p) => p.method === 'credit')
    if (ci >= 0 && creditBalance !== null && list.length === 2) {
      setParts(withAmount(list, ci, Math.min(Math.max(0, creditBalance), total)))
      return
    }
    setParts(list)
  }

  function setAmount(i: number, text: string) {
    setParts((ps) => {
      const n = parseMoney(text)
      if (ps.length !== 2 || n === null || Number.isNaN(n)) return ps.map((p, j) => (j === i ? { ...p, amount: text } : p))
      // Conserva lo que se está escribiendo tal cual y ajusta el otro.
      const next = withAmount(ps, i, Math.min(n, total))
      next[i] = { ...next[i], amount: text }
      return next
    })
  }

  // "Usar todo el saldo posible" en créditos.
  function useAllCredit() {
    if (creditIdx < 0 || creditBalance === null) return
    setParts((ps) => withAmount(ps, creditIdx, Math.min(Math.max(0, creditBalance), total)))
  }

  // Si el saldo llega después de elegir créditos y no alcanza, se ajusta solo (con dos métodos).
  useEffect(() => {
    if (creditBalance === null || creditIdx < 0 || parts.length !== 2) return
    if (cents(value(parts[creditIdx].amount)) > cents(creditBalance)) {
      setParts((ps) => withAmount(ps, creditIdx, Math.max(0, creditBalance)))
    }
  }, [creditBalance])

  const invalidAmount = parts.some((p, i) => !single && (Number.isNaN(parseMoney(p.amount) ?? 0) || amounts[i] <= 0))
  const canPay =
    hasLines &&
    online &&
    !paying &&
    parts.length > 0 &&
    remaining === 0 &&
    !invalidAmount &&
    !creditProblem &&
    (creditIdx < 0 || creditBalance !== null) &&
    !cashShort &&
    !chargeProblem

  function pay() {
    if (!canPay) return
    onPay(
      parts.map((p, i) => ({ method: p.method, amount: Math.round(amounts[i] * 100) / 100 })),
      cashIdx >= 0 && change !== null ? change : null,
    )
  }

  return (
    <div className="card flex flex-col gap-4 p-5 2xl:sticky 2xl:top-4">
      {/* StatBlock: el total de la venta es la pieza extruida de la pantalla. */}
      <div className="kn-block kn-deep flex flex-col gap-1 px-5 pt-4 pb-5" role="group" aria-label={title}>
        <span className="stat-label">{title}</span>
        <span className="stat-value">{formatMoney(ticketTotal)}</span>
        <span className="text-caption">
          {formatInt(pieces)} {pieces === 1 ? 'artículo' : 'artículos'}
        </span>
      </div>

      {partial && (
        <div>
          <label htmlFor="pos-charge" className="field-label">
            {partial.label}
          </label>
          <div className="flex items-center gap-2">
            <span className="text-ink-muted">$</span>
            <input
              id="pos-charge"
              value={chargeText}
              onChange={(e) => {
                setChargeText(e.target.value)
                // Con un solo método, su monto sigue al abono; con varios se reparten de nuevo.
                if (parts.length > 1) setParts((ps) => ps.slice(0, 1))
              }}
              onFocus={(e) => e.target.select()}
              inputMode="decimal"
              autoComplete="off"
              className="field text-right tabular-nums"
            />
          </div>
          <p className={`mt-1 text-caption ${chargeProblem ? 'text-danger-fg' : 'text-ink-subtle'}`}>
            {chargeProblem ??
              (partial.min < partial.max
                ? `Mínimo ${formatMoney(partial.min)} · máximo ${formatMoney(partial.max)}`
                : `Monto: ${formatMoney(partial.max)}`)}
          </p>
        </div>
      )}

      <div>
        <span className="field-label">Forma de pago {parts.length > 1 && '(mixto)'}</span>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Forma de pago">
          {methods.map((m) => {
            const on = parts.some((p) => p.method === m)
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(m)}
                className={`choice ${m === 'credit' ? 'choice-gold' : ''}`}
              >
                {PAYMENT_LABELS[m]}
              </button>
            )
          })}
        </div>
        {parts.length === 1 && (
          <p className="mt-2 text-caption text-ink-subtle">Para pagar con otro método además de este, elígelo también.</p>
        )}
      </div>

      {parts.length > 1 && (
        <ul className="space-y-2" aria-label="Montos por forma de pago">
          {parts.map((p, i) => (
            <li key={p.method} className="flex items-center gap-2">
              <label htmlFor={`pay-${p.method}`} className="flex-1 text-label">
                {PAYMENT_LABELS[p.method]}
              </label>
              <span className="text-ink-muted">$</span>
              <input
                id={`pay-${p.method}`}
                value={p.amount}
                onChange={(e) => setAmount(i, e.target.value)}
                onFocus={(e) => e.target.select()}
                inputMode="decimal"
                autoComplete="off"
                className="field w-28 text-right tabular-nums"
              />
            </li>
          ))}
          <li
            className={`flex justify-between border-t border-line pt-2 text-label ${remaining === 0 ? 'text-success-fg' : 'text-danger-fg'}`}
            role="status"
          >
            <span>{remaining === 0 ? 'Cubierto' : remaining > 0 ? 'Falta asignar' : 'Excede el total por'}</span>
            <span className="tabular-nums">{remaining === 0 ? formatMoney(total) : formatMoney(Math.abs(remaining) / 100)}</span>
          </li>
        </ul>
      )}

      {creditIdx >= 0 && (
        <div className="rounded-md border-2 border-gold bg-gold-soft p-3">
          <p className="flex items-center justify-between gap-2 text-label">
            <span>Créditos de {customer?.name ?? '—'}</span>
            <span className="font-display text-heading font-extrabold tabular-nums">{creditBalance === null ? (customer && online && !credit?.error ? 'Consultando…' : '—') : formatMoney(creditBalance)}</span>
          </p>
          {parts.length > 1 && creditBalance !== null && creditBalance > 0 && (
            <button type="button" onClick={useAllCredit} className="btn btn-ghost btn-sm mt-1 px-0">
              Usar todo el saldo posible
            </button>
          )}
          {creditProblem && (
            <p className="mt-2 flex items-start gap-1.5 text-caption text-danger-fg" role="alert">
              <Icon name="alert" className="mt-0.5" />
              {creditProblem}
            </p>
          )}
        </div>
      )}

      {cashIdx >= 0 && (
        <div>
          <label htmlFor="pos-received" className="field-label">
            Efectivo recibido (opcional, para calcular el cambio)
          </label>
          <input
            id="pos-received"
            value={received}
            onChange={(e) => setReceived(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            className="field tabular-nums"
          />
          {change !== null && (
            <p className={`mt-2 flex justify-between text-heading ${cashShort ? 'text-danger-fg' : ''}`}>
              <span>{cashShort ? 'Falta' : 'Cambio'}</span>
              <span className="tabular-nums">{formatMoney(Math.abs(change))}</span>
            </p>
          )}
        </div>
      )}

      {footer}

      {/* Pagar todo con créditos es dinero de la tienda: botón dorado. */}
      <button
        type="button"
        onClick={pay}
        disabled={!canPay}
        className={`btn btn-lg btn-block mt-1 ${parts.length === 1 && parts[0].method === 'credit' ? 'btn-gold' : 'btn-primary'}`}
      >
        <Icon name="check" size={20} />
        {paying ? 'Cobrando…' : actionLabel ? actionLabel(total) : `Cobrar ${formatMoney(total)}`}
      </button>
      {parts.length === 0 && hasLines && <p className="-mt-2 text-center text-caption text-ink-subtle">Elige la forma de pago.</p>}
      {!online && hasLines && <p className="-mt-2 text-center text-caption text-warning-fg">Sin conexión: cobra cuando vuelva el internet.</p>}
    </div>
  )
}
