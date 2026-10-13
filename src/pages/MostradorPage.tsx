import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CustomerFormModal } from '../components/CustomerFormModal'
import { Icon } from '../components/Icon'
import { ProductImage } from '../components/ProductImage'
import { CustomerPicker } from '../components/pos/CustomerPicker'
import { PaymentPanel } from '../components/pos/PaymentPanel'
import { ProductPicker } from '../components/pos/ProductPicker'
import { gameSuggestions } from '../lib/customers'
import { formatInt, formatMoney } from '../lib/format'
import { sounds } from '../lib/sounds'
import { PAYMENT_LABELS, type PaymentPart } from '../lib/types'
import { inventoryStore, type CachedProduct } from '../store/inventoryStore'
import { useInventory } from '../store/useInventory'
import { posStore, ticketPieces, ticketTotal, usePos, type OpenTicket, type PosLine } from '../store/posStore'


type Notice = { kind: 'error' | 'info'; text: string } | null
type LastSale = { name: string; total: number; payments: PaymentPart[]; change: number | null; pending: boolean } | null

export function MostradorPage() {
  const { products, online } = useInventory()
  const { tickets, activeId, customers } = usePos()
  const active = tickets.find((t) => t.id === activeId) ?? null

  const [newName, setNewName] = useState('')
  const [notice, setNotice] = useState<Notice>(null)
  const [paying, setPaying] = useState(false)
  const [lastSale, setLastSale] = useState<LastSale>(null)
  const [renaming, setRenaming] = useState(false)
  const [creatingCustomer, setCreatingCustomer] = useState<string | null>(null)
  const productRef = useRef<HTMLInputElement>(null)
  const newRef = useRef<HTMLInputElement>(null)

  const focusProduct = useCallback(() => setTimeout(() => productRef.current?.focus(), 0), [])

  // Al entrar: inventario y clientes frescos si hay red (si no, se usan las copias locales).
  useEffect(() => {
    if (!online) return
    void inventoryStore.refreshProducts()
    posStore.loadCustomers().catch(() => undefined)
    // Solo al entrar a la página.
  }, [])

  // Cambiar de ticket reinicia el cobro.
  useEffect(() => {
    setRenaming(false)
    setNotice(null)
    if (activeId) focusProduct()
  }, [activeId, focusProduct])

  // Depende de los tickets: lo apartado cambia al agregar o cobrar.
  const available = useCallback((p: CachedProduct) => posStore.available(p), [tickets])

  function createTicket(e: FormEvent) {
    e.preventDefault()
    const name = newName.trim() || `Ticket ${tickets.length + 1}`
    posStore.createTicket(name)
    setNewName('')
    setLastSale(null)
  }

  function addProduct(p: CachedProduct) {
    if (!active) return
    const res = posStore.addProduct(active.id, p)
    if (res.ok) {
      sounds.success()
      setNotice(null)
      setLastSale(null)
    } else {
      sounds.error()
      setNotice({ kind: 'error', text: res.message })
    }
    focusProduct()
  }

  async function pay(payments: PaymentPart[], change: number | null) {
    if (!active || paying || active.lines.length === 0) return
    setPaying(true)
    setNotice(null)
    const out = await inventoryStore.paySale({
      ticketId: active.id,
      name: active.name,
      customerId: active.customer?.id ?? null,
      customerName: active.customer?.name ?? null,
      paymentMethod: payments.length > 1 ? 'mixed' : payments[0].method,
      payments,
      openedAt: active.openedAt,
      items: active.lines.map((l) => ({ barcode: l.barcode, name: l.name, quantity: l.quantity, unitPrice: l.unitPrice })),
    })
    setPaying(false)
    if (out.type === 'error') {
      sounds.error()
      setNotice({ kind: 'error', text: out.message })
      return
    }
    sounds.success()
    setLastSale({ name: active.name, total: out.total, payments, change, pending: out.pending })
    posStore.closeTicket(active.id)
  }

  return (
    <div className="flex min-h-full flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-title">Mostrador</h1>
        <Link to="/ventas" className="btn btn-secondary">
          <Icon name="receipt" />
          Ventas
        </Link>
      </div>

      {!online && (
        <p className="notice bg-warning-bg text-warning-fg">
          <Icon name="wifi-off" className="mt-0.5" />
          Sin conexión: puedes seguir vendiendo. Las ventas se guardan en esta computadora y se registran solas al volver
          el internet.
        </p>
      )}

      {lastSale && (
        <div className={`flex flex-wrap items-center gap-4 rounded-lg border-2 p-5 ${lastSale.pending ? 'border-warning-solid bg-warning-bg text-warning-fg' : 'border-success-solid bg-success-bg text-success-fg'}`} aria-live="polite">
          <Icon name="check" size={32} />
          <div className="mr-auto">
            <p className="text-title">
              {lastSale.pending ? 'Venta guardada sin conexión (pendiente)' : 'Venta registrada'} · {lastSale.name}
            </p>
            <p className="text-heading">
              {formatMoney(lastSale.total)} con{' '}
              {lastSale.payments.length === 1
                ? PAYMENT_LABELS[lastSale.payments[0].method].toLowerCase()
                : lastSale.payments.map((p) => `${PAYMENT_LABELS[p.method].toLowerCase()} ${formatMoney(p.amount)}`).join(' + ')}
            </p>
          </div>
          {lastSale.change !== null && lastSale.change > 0 && (
            <div className="text-right">
              <p className="text-label">Cambio</p>
              <p className="text-display tabular-nums">{formatMoney(lastSale.change)}</p>
            </div>
          )}
        </div>
      )}

      <div className="grid flex-1 items-start gap-4 lg:grid-cols-[260px_1fr]">
        {/* Tickets abiertos */}
        <aside className="card flex flex-col">
          <h2 className="border-b border-line px-4 py-3 text-heading">Tickets abiertos</h2>
          {tickets.length === 0 && <p className="px-4 py-6 text-center text-ink-subtle">No hay tickets abiertos.</p>}
          <ul className="divide-y divide-line">
            {tickets.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => {
                    posStore.select(t.id)
                    setLastSale(null)
                  }}
                  aria-current={t.id === activeId}
                  className={`flex w-full cursor-pointer flex-col gap-0.5 px-4 py-3 text-left ${t.id === activeId ? 'bg-brand-soft' : 'hover:bg-subtle'}`}
                >
                  <span className={`truncate text-label ${t.id === activeId ? 'text-brand-ink' : 'text-ink'}`}>{t.name}</span>
                  {t.customer && <span className="truncate text-caption text-ink-muted">{t.customer.name}</span>}
                  <span className="flex justify-between text-caption text-ink-subtle">
                    <span>{formatInt(ticketPieces(t))} pzas</span>
                    <span className="tabular-nums">{formatMoney(ticketTotal(t))}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={createTicket} className="flex gap-2 border-t border-line p-3">
            <input
              ref={newRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={`Ticket ${tickets.length + 1}`}
              aria-label="Nombre del ticket nuevo"
              className="field"
            />
            <button type="submit" className="btn btn-primary" title="Abrir ticket nuevo">
              <Icon name="plus" />
              Nuevo
            </button>
          </form>
        </aside>

        {/* Ticket activo */}
        {!active ? (
          <section className="card flex min-h-80 flex-col items-center justify-center gap-3 p-8 text-center">
            <Icon name="receipt" size={40} className="text-ink-subtle" />
            <p className="text-title-lg text-ink-muted">Abre un ticket para empezar a vender</p>
            <p className="text-ink-subtle">Ponle un nombre (p. ej. "Mesa 3" o el nombre del cliente) y presiona "Nuevo".</p>
            <button type="button" onClick={() => newRef.current?.focus()} className="btn btn-primary btn-lg mt-2">
              <Icon name="plus" size={20} />
              Nuevo ticket
            </button>
          </section>
        ) : (
          <section className="grid items-start gap-4 2xl:grid-cols-[1fr_320px]">
            <div className="card flex min-w-0 flex-col gap-4 p-5">
              <TicketHeader
                ticket={active}
                renaming={renaming}
                setRenaming={setRenaming}
                onRemove={() => posStore.removeTicket(active.id)}
              />

              <div>
                <span className="field-label">Cliente</span>
                {active.customer ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-2 rounded-pill bg-brand-soft px-3 py-1.5 text-label text-brand-ink">
                      <Icon name="users" />
                      {active.customer.name}
                    </span>
                    <button type="button" onClick={() => posStore.setCustomer(active.id, null)} className="btn btn-ghost btn-sm">
                      Quitar
                    </button>
                  </div>
                ) : (
                  <CustomerPicker
                    customers={customers}
                    canCreate={online}
                    onPick={(c) => {
                      posStore.setCustomer(active.id, { id: c.id, name: c.name })
                      focusProduct()
                    }}
                    onCreate={(name) => setCreatingCustomer(name)}
                  />
                )}
              </div>

              <ProductPicker inputRef={productRef} products={products} available={available} onPick={addProduct} />

              {notice && (
                <p className={`notice ${notice.kind === 'error' ? 'bg-danger-bg text-danger-fg' : 'bg-info-bg text-info-fg'}`} role="alert">
                  <Icon name="alert" className="mt-0.5" />
                  {notice.text}
                </p>
              )}

              <TicketLines ticket={active} products={products} onChanged={focusProduct} />
            </div>

            {/* Cobro: se reinicia al cambiar de ticket */}
            <PaymentPanel
              key={active.id}
              total={ticketTotal(active)}
              pieces={ticketPieces(active)}
              hasLines={active.lines.length > 0}
              customer={active.customer}
              online={online}
              paying={paying}
              onPay={(payments, change) => void pay(payments, change)}
            />
          </section>
        )}
      </div>

      {creatingCustomer !== null && active && (
        <CustomerFormModal
          customer={null}
          initialName={creatingCustomer}
          gameSuggestions={gameSuggestions(customers)}
          onCancel={() => setCreatingCustomer(null)}
          onSaved={(c) => {
            posStore.addCustomer(c)
            posStore.setCustomer(active.id, { id: c.id, name: c.name })
            setCreatingCustomer(null)
            focusProduct()
          }}
        />
      )}
    </div>
  )
}

function TicketHeader({
  ticket,
  renaming,
  setRenaming,
  onRemove,
}: {
  ticket: OpenTicket
  renaming: boolean
  setRenaming: (v: boolean) => void
  onRemove: () => void
}) {
  const [name, setName] = useState(ticket.name)
  useEffect(() => setName(ticket.name), [ticket.name, renaming])

  if (renaming) {
    return (
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          posStore.rename(ticket.id, name)
          setRenaming(false)
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Nombre del ticket" className="field h-10 max-w-sm" />
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          Guardar
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setRenaming(false)}>
          Cancelar
        </button>
      </form>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="mr-auto min-w-0">
        <h2 className="truncate text-title">{ticket.name}</h2>
        <p className="text-caption text-ink-subtle">
          Abierto {new Date(ticket.openedAt).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
        </p>
      </div>
      <button type="button" onClick={() => setRenaming(true)} className="btn btn-ghost btn-sm">
        Renombrar
      </button>
      {ticket.lines.length === 0 && (
        <button type="button" onClick={onRemove} className="btn btn-danger btn-sm">
          Eliminar ticket
        </button>
      )}
    </div>
  )
}

function TicketLines({
  ticket,
  products,
  onChanged,
}: {
  ticket: OpenTicket
  products: Record<string, CachedProduct>
  onChanged: () => void
}) {
  if (ticket.lines.length === 0) {
    return <p className="rounded-md border border-dashed border-line px-4 py-10 text-center text-ink-subtle">El ticket está vacío.</p>
  }
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-subtle text-label whitespace-nowrap text-ink-muted">
            <th className="h-control-md px-3 font-medium">Producto</th>
            <th className="h-control-md px-3 text-right font-medium">Precio</th>
            <th className="h-control-md px-3 text-center font-medium">Cantidad</th>
            <th className="h-control-md px-3 text-right font-medium">Importe</th>
            <th className="h-control-md w-10 px-3">
              <span className="sr-only">Quitar</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {ticket.lines.map((l) => (
            <LineRow key={l.barcode} ticket={ticket} line={l} product={products[l.barcode]} onChanged={onChanged} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LineRow({
  ticket,
  line,
  product,
  onChanged,
}: {
  ticket: OpenTicket
  line: PosLine
  product: CachedProduct | undefined
  onChanged: () => void
}) {
  const [text, setText] = useState(String(line.quantity))
  useEffect(() => setText(String(line.quantity)), [line.quantity])
  const max = product ? posStore.maxFor(ticket.id, product) : line.quantity

  function commit(value: number) {
    if (!product) return
    const q = posStore.setQuantity(ticket.id, product, Number.isFinite(value) ? value : line.quantity)
    setText(String(q))
  }

  return (
    <tr className="border-t border-line">
      <td className="px-3 py-2">
        <div className="flex items-center gap-3">
          <ProductImage path={line.imagePath} alt="" className="size-10 shrink-0 rounded-xs" />
          <div className="min-w-40">
            <p className="text-label text-ink">{line.name}</p>
            <p className="font-mono text-caption text-ink-subtle">{line.barcode}</p>
            {!product && <p className="text-caption text-danger-fg">Este producto ya no está en el inventario.</p>}
          </div>
        </div>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(line.unitPrice)}</td>
      <td className="px-3 py-2">
        <div className="mx-auto flex w-fit items-center gap-1">
          <button
            type="button"
            aria-label={`Quitar una pieza de ${line.name}`}
            disabled={line.quantity <= 1}
            onClick={() => commit(line.quantity - 1)}
            className="btn btn-secondary btn-sm w-8 px-0"
          >
            −
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => commit(Number(text))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit(Number(text))
                onChanged()
              }
            }}
            inputMode="numeric"
            aria-label={`Cantidad de ${line.name}`}
            className="field h-control-sm w-14 px-1 text-center tabular-nums"
          />
          <button
            type="button"
            aria-label={`Agregar una pieza de ${line.name}`}
            disabled={!product || line.quantity >= max}
            title={product && line.quantity >= max ? 'No hay más stock disponible' : undefined}
            onClick={() => commit(line.quantity + 1)}
            className="btn btn-secondary btn-sm w-8 px-0"
          >
            +
          </button>
        </div>
      </td>
      <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(line.quantity * line.unitPrice)}</td>
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={() => {
            posStore.removeLine(ticket.id, line.barcode)
            onChanged()
          }}
          aria-label={`Quitar ${line.name} del ticket`}
          className="grid size-8 cursor-pointer place-items-center rounded-md text-ink-muted hover:bg-danger-bg hover:text-danger-fg"
        >
          <Icon name="x" />
        </button>
      </td>
    </tr>
  )
}
