import { useSyncExternalStore } from 'react'
import { listCustomers } from '../lib/customers'
import type { Customer } from '../lib/types'
import type { CachedProduct } from './inventoryStore'

/*
 * Estado del mostrador (punto de venta).
 *
 * Hay un solo POS, así que los tickets ABIERTOS viven en esta computadora
 * (localStorage): funcionan sin conexión y no se pierden al recargar. Al
 * cobrar, la venta se manda al servidor con inventoryStore.paySale y el
 * ticket se cierra aquí.
 *
 * Stock "apartado": lo que ya está en algún ticket abierto. Un producto solo
 * se puede agregar si stock − apartado > 0.
 */

export interface PosLine {
  barcode: string
  name: string
  unitPrice: number
  quantity: number
  imagePath: string | null
}

export interface OpenTicket {
  /** También es el id con el que se registra la venta (idempotencia). */
  id: string
  name: string
  customer: { id: string; name: string } | null
  lines: PosLine[]
  openedAt: string
}

interface PosState {
  tickets: OpenTicket[]
  activeId: string | null
  /** Copia de los clientes para poder asignarlos sin conexión. */
  customers: Customer[]
}

const KEYS = { tickets: 'hachiko.pos.tickets.v1', active: 'hachiko.pos.active.v1', customers: 'hachiko.pos.customers.v1' }

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.error('No se pudo guardar en localStorage', key, e)
  }
}

export type AddResult = { ok: true } | { ok: false; message: string }

class PosStore {
  private state: PosState
  private listeners = new Set<() => void>()

  constructor() {
    const tickets = load<OpenTicket[]>(KEYS.tickets, [])
    const activeId = load<string | null>(KEYS.active, null)
    this.state = {
      tickets,
      activeId: tickets.some((t) => t.id === activeId) ? activeId : (tickets[0]?.id ?? null),
      customers: load<Customer[]>(KEYS.customers, []),
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.state

  private set(patch: Partial<PosState>) {
    this.state = { ...this.state, ...patch }
    if (patch.tickets) save(KEYS.tickets, this.state.tickets)
    if ('activeId' in patch) save(KEYS.active, this.state.activeId)
    if (patch.customers) save(KEYS.customers, this.state.customers)
    this.listeners.forEach((l) => l())
  }

  private updateTicket(id: string, fn: (t: OpenTicket) => OpenTicket) {
    this.set({ tickets: this.state.tickets.map((t) => (t.id === id ? fn(t) : t)) })
  }

  // ---------- tickets ----------
  createTicket(name: string) {
    const ticket: OpenTicket = {
      id: crypto.randomUUID(),
      name: name.trim(),
      customer: null,
      lines: [],
      openedAt: new Date().toISOString(),
    }
    this.set({ tickets: [...this.state.tickets, ticket], activeId: ticket.id })
    return ticket
  }

  select(id: string) {
    this.set({ activeId: id })
  }

  rename(id: string, name: string) {
    if (!name.trim()) return
    this.updateTicket(id, (t) => ({ ...t, name: name.trim() }))
  }

  setCustomer(id: string, customer: { id: string; name: string } | null) {
    this.updateTicket(id, (t) => ({ ...t, customer }))
  }

  /** Solo tickets vacíos (no hay cancelaciones de tickets con productos). */
  removeTicket(id: string) {
    const ticket = this.state.tickets.find((t) => t.id === id)
    if (!ticket || ticket.lines.length > 0) return
    this.closeTicket(id)
  }

  /** Quita el ticket de los abiertos (después de cobrarlo). */
  closeTicket(id: string) {
    const tickets = this.state.tickets.filter((t) => t.id !== id)
    const activeId = this.state.activeId === id ? (tickets[0]?.id ?? null) : this.state.activeId
    this.set({ tickets, activeId })
  }

  // ---------- stock apartado ----------
  /** Piezas de un producto en tickets abiertos (opcionalmente sin contar uno). */
  reserved(barcode: string, exceptTicketId?: string) {
    let n = 0
    for (const t of this.state.tickets) {
      if (t.id === exceptTicketId) continue
      for (const l of t.lines) if (l.barcode === barcode) n += l.quantity
    }
    return n
  }

  /** Máximo que puede llevar este ticket de un producto. */
  maxFor(ticketId: string, product: CachedProduct) {
    return Math.max(0, product.quantity - this.reserved(product.barcode, ticketId))
  }

  /** Disponible para agregar en cualquier ticket: stock − todo lo apartado. */
  available(product: CachedProduct) {
    return product.quantity - this.reserved(product.barcode)
  }

  // ---------- productos del ticket ----------
  addProduct(ticketId: string, product: CachedProduct, quantity = 1): AddResult {
    const ticket = this.state.tickets.find((t) => t.id === ticketId)
    if (!ticket) return { ok: false, message: 'No hay un ticket abierto' }
    if (product.pending && product.is_internal_code) {
      return { ok: false, message: 'Este producto aún no se sincroniza (le falta su código HCH-). Espera a tener conexión.' }
    }
    const current = ticket.lines.find((l) => l.barcode === product.barcode)?.quantity ?? 0
    const max = this.maxFor(ticketId, product)
    if (current + quantity > max) {
      const elsewhere = this.reserved(product.barcode, ticketId)
      return {
        ok: false,
        message:
          product.quantity <= 0
            ? `${product.name} no tiene stock.`
            : `No hay más stock de ${product.name}: hay ${product.quantity}` +
              (elsewhere > 0 ? `, ${elsewhere} apartado(s) en otros tickets abiertos` : '') +
              (current > 0 ? ` y ${current} ya en este ticket` : '') +
              '.',
      }
    }
    this.updateTicket(ticketId, (t) => {
      const exists = t.lines.some((l) => l.barcode === product.barcode)
      const lines = exists
        ? t.lines.map((l) => (l.barcode === product.barcode ? { ...l, quantity: l.quantity + quantity } : l))
        : [
            ...t.lines,
            { barcode: product.barcode, name: product.name, unitPrice: product.price, quantity, imagePath: product.image_url },
          ]
      return { ...t, lines }
    })
    return { ok: true }
  }

  /** Cambia la cantidad de un renglón; se limita a lo disponible. Devuelve la cantidad que quedó. */
  setQuantity(ticketId: string, product: CachedProduct, quantity: number) {
    const q = Math.max(1, Math.min(Math.floor(quantity), this.maxFor(ticketId, product)))
    this.updateTicket(ticketId, (t) => ({
      ...t,
      lines: t.lines.map((l) => (l.barcode === product.barcode ? { ...l, quantity: q } : l)),
    }))
    return q
  }

  removeLine(ticketId: string, barcode: string) {
    this.updateTicket(ticketId, (t) => ({ ...t, lines: t.lines.filter((l) => l.barcode !== barcode) }))
  }

  // ---------- clientes ----------
  async loadCustomers() {
    const customers = await listCustomers()
    this.set({ customers })
    return customers
  }

  addCustomer(customer: Customer) {
    const customers = [...this.state.customers.filter((c) => c.id !== customer.id), customer].sort((a, b) =>
      a.name.localeCompare(b.name, 'es-MX'),
    )
    this.set({ customers })
  }
}

export const posStore = new PosStore()

export function usePos() {
  return useSyncExternalStore(posStore.subscribe, posStore.getSnapshot)
}

export const ticketTotal = (t: OpenTicket) => t.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0)
export const ticketPieces = (t: OpenTicket) => t.lines.reduce((n, l) => n + l.quantity, 0)
