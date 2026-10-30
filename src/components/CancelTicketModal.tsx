import { useState } from 'react'
import { formatMoney } from '../lib/format'
import { Icon } from './Icon'

interface Props {
  /** "Cancelar ticket", "Cancelar preventa #12"… */
  title: string
  /** Qué pasa al cancelar (inventario, registro). */
  description: string
  /** Pagos que se pueden devolver; sin monto no se pregunta. */
  refundable?: number
  onConfirm: (reason: string | null, refund: boolean) => Promise<string | null>
  onClose: () => void
}

/** Confirmación de cancelación con motivo opcional (y devolución de pagos si los hay). */
export function CancelTicketModal({ title, description, refundable = 0, onConfirm, onClose }: Props) {
  const [reason, setReason] = useState('')
  const [refund, setRefund] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    const err = await onConfirm(reason.trim() || null, refundable > 0 && refund)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-scrim p-4" role="dialog" aria-modal="true" aria-labelledby="ct-title">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void confirm()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
        className="max-h-full w-full max-w-lg overflow-auto dialog"
      >
        <div className="border-b border-line px-6 py-5">
          <h2 id="ct-title" className="text-title">
            {title}
          </h2>
          <p className="mt-1 text-ink-muted">{description}</p>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="field-label" htmlFor="ct-reason">
              Motivo (opcional)
            </label>
            <input
              id="ct-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej. El cliente ya no lo quiso"
              autoFocus
              autoComplete="off"
              className="field"
            />
          </div>
          {refundable > 0 && (
            <label className="flex cursor-pointer items-start gap-2">
              <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} className="mt-1 size-4" />
              <span>
                Devolver lo pagado ({formatMoney(refundable)})
                <span className="block text-caption text-ink-subtle">
                  Los créditos regresan al saldo del cliente; lo demás cuenta como devolución del día. Desmárcalo si el anticipo no se devuelve.
                </span>
              </span>
            </label>
          )}
          {error && (
            <p className="notice bg-danger-bg text-danger-fg" role="alert">
              <Icon name="alert" className="mt-0.5" />
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Volver
          </button>
          <button type="submit" disabled={busy} className="btn btn-danger">
            {busy ? 'Cancelando…' : 'Sí, cancelar'}
          </button>
        </div>
      </form>
    </div>
  )
}
