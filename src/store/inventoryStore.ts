import { isAuthError, isNetworkError, probeConnection, supabase } from '../lib/supabase'
import { normalizeBarcode } from '../lib/barcode'
import { uploadProductImage } from '../lib/images'
import type { CreateRpcResult, MovementResult, Product, ScanMode, ScanRpcResult } from '../lib/types'

/*
 * Estado de inventario del lado del cliente:
 *  - Caché de productos (código → producto) para saber si un código existe aun sin red
 *    y para calcular los contadores.
 *  - Cola de operaciones pendientes (localStorage). Cada operación lleva un
 *    client_op_id: si se reintenta, el servidor no la duplica.
 *  - Últimos escaneos de la sesión (para el panel y "Deshacer").
 *
 * Todas las operaciones se ejecutan en serie (una tras otra) para respetar el
 * orden de escaneo, tanto en línea como al sincronizar la cola.
 */

export interface CachedProduct {
  id: string
  barcode: string
  name: string
  category: string | null
  supplier: string | null
  price: number
  quantity: number
  image_url: string | null
  is_internal_code: boolean
  /** Alta que aún está en la cola (no existe en el servidor todavía). */
  pending?: boolean
}

export interface CreateInput {
  barcode: string | null // null = generar código interno HCH-
  name: string
  price: number
  cost: number | null
  category: string | null
  supplier: string | null
  initialQuantity: number
}

type QueueItem =
  | { kind: 'scan'; opId: string; createdAt: string; barcode: string; mode: ScanMode; quantity: number }
  | { kind: 'create'; opId: string; createdAt: string; input: CreateInput; imagePath: string | null }
  | { kind: 'undo'; opId: string; createdAt: string; movementId: string; barcode: string }

export interface RecentEntry {
  /** = client_op_id de la operación */
  key: string
  at: string
  kind: 'scan' | 'create'
  barcode: string
  name: string
  imagePath: string | null
  mode: ScanMode | null
  amount: number
  delta: number
  quantityAfter: number
  movementId: string | null
  pending: boolean
  undone: boolean
  error?: string
}

export interface FailedOp {
  item: QueueItem
  error: string
  at: string
}

export interface InventoryState {
  products: Record<string, CachedProduct>
  productsLoaded: boolean
  queue: QueueItem[]
  failed: FailedOp[]
  recent: RecentEntry[]
  online: boolean
  syncing: boolean
  syncError: string | null
}

export type ScanOutcome =
  | { type: 'ok'; product: CachedProduct; delta: number; quantityAfter: number; mode: ScanMode; pending: boolean }
  | { type: 'not_found'; barcode: string; offline: boolean }
  | { type: 'error'; message: string }

export type CreateOutcome =
  | {
      type: 'ok'
      product: CachedProduct
      quantityAfter: number
      pending: boolean
      /** El código ya existía: se sumó la cantidad inicial en lugar de crear. */
      existed: boolean
      imageSkipped: boolean
    }
  | { type: 'error'; message: string }

export type UndoOutcome =
  | { type: 'ok'; entry: RecentEntry; quantityAfter: number; pending: boolean }
  | { type: 'nothing' }
  | { type: 'error'; message: string }

const KEYS = {
  products: 'hachiko.products.v1',
  queue: 'hachiko.queue.v1',
  failed: 'hachiko.failed.v1',
  recent: 'hachiko.recent.v1',
}
const RECENT_LIMIT = 10
const RETRY_INTERVAL_MS = 15_000

class PermanentError extends Error {}

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

function toCached(p: Product): CachedProduct {
  return {
    id: p.id,
    barcode: p.barcode,
    name: p.name,
    category: p.category,
    supplier: p.supplier,
    price: Number(p.price),
    quantity: p.quantity,
    image_url: p.image_url,
    is_internal_code: p.is_internal_code,
  }
}

function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message
  const m = (e as { message?: string })?.message
  return m ?? String(e)
}

function queueBarcode(q: QueueItem): string | null {
  return q.kind === 'create' ? q.input.barcode : q.barcode
}

function rpcError(error: unknown): never {
  throw error
}

class InventoryStore {
  private state: InventoryState
  private listeners = new Set<() => void>()
  private chain: Promise<unknown> = Promise.resolve()
  private started = false

  constructor() {
    const products = load<Record<string, CachedProduct>>(KEYS.products, {})
    this.state = {
      products,
      productsLoaded: Object.keys(products).length > 0,
      queue: load<QueueItem[]>(KEYS.queue, []),
      failed: load<FailedOp[]>(KEYS.failed, []),
      recent: load<RecentEntry[]>(KEYS.recent, []),
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
      syncing: false,
      syncError: null,
    }
  }

  // ---------- suscripción (useSyncExternalStore) ----------
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.state

  private set(patch: Partial<InventoryState>) {
    this.state = { ...this.state, ...patch }
    if (patch.products) save(KEYS.products, this.state.products)
    if (patch.queue) save(KEYS.queue, this.state.queue)
    if (patch.failed) save(KEYS.failed, this.state.failed)
    if (patch.recent) save(KEYS.recent, this.state.recent)
    this.listeners.forEach((l) => l())
  }

  /** Ejecuta tareas en serie, en el orden en que se piden. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const p = this.chain.then(task)
    this.chain = p.catch(() => undefined)
    return p
  }

  // ---------- arranque ----------
  start() {
    if (this.started) return
    this.started = true
    window.addEventListener('online', () => void this.checkConnection())
    window.addEventListener('offline', () => this.set({ online: false }))
    setInterval(() => {
      if (this.state.queue.length > 0 || !this.state.online) void this.checkConnection()
    }, RETRY_INTERVAL_MS)
    supabase.auth.onAuthStateChange((event, session) => {
      if (!session) return
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
        // Fuera del callback de auth, como recomienda supabase-js.
        setTimeout(() => {
          if (this.state.syncError) this.set({ syncError: null })
          void this.syncNow().then(() => this.refreshProducts())
        }, 0)
      }
    })
  }

  /** Comprueba conectividad real y, si hay, sincroniza. */
  async checkConnection() {
    const ok = await probeConnection()
    if (ok !== this.state.online) this.set({ online: ok })
    if (ok && this.state.queue.length > 0) await this.syncNow()
  }

  private markOffline() {
    if (this.state.online) this.set({ online: false })
  }

  private markOnline() {
    if (!this.state.online) this.set({ online: true })
  }

  // ---------- caché de productos ----------
  refreshProducts() {
    return this.run(async () => {
      if (this.state.queue.length > 0) return // no pisar lo optimista con datos viejos
      const { data: s } = await supabase.auth.getSession()
      if (!s.session) return
      const all: Record<string, CachedProduct> = {}
      const PAGE = 1000
      try {
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase
            .from('products')
            .select('id, barcode, name, category, supplier, price, quantity, image_url, is_internal_code')
            .order('created_at', { ascending: true })
            .range(from, from + PAGE - 1)
          if (error) throw error
          for (const p of (data ?? []) as Product[]) all[p.barcode] = toCached(p)
          if (!data || data.length < PAGE) break
        }
        this.markOnline()
        this.set({ products: all, productsLoaded: true })
      } catch (e) {
        if (isNetworkError(e)) this.markOffline()
        else console.error('No se pudo cargar el catálogo', e)
      }
    })
  }

  private putProduct(p: CachedProduct, removeBarcode?: string) {
    const products = { ...this.state.products }
    if (removeBarcode) delete products[removeBarcode]
    products[p.barcode] = p
    this.set({ products })
  }

  /**
   * Guarda un producto recién devuelto por el servidor. Si en la cola quedan
   * otras operaciones del mismo código, conserva la cantidad local (optimista),
   * que ya las incluye.
   */
  private putServerProduct(product: CachedProduct, opId: string, removeBarcode?: string) {
    const keys = new Set([product.barcode, removeBarcode].filter(Boolean))
    const othersQueued = this.state.queue.some((q) => q.opId !== opId && keys.has(queueBarcode(q) ?? ''))
    const local = this.state.products[removeBarcode ?? product.barcode]
    this.putProduct(othersQueued && local ? { ...product, quantity: local.quantity } : product, removeBarcode)
  }

  private addRecent(entry: RecentEntry) {
    this.set({ recent: [entry, ...this.state.recent].slice(0, RECENT_LIMIT) })
  }

  private patchRecent(key: string, patch: Partial<RecentEntry>) {
    if (!this.state.recent.some((r) => r.key === key)) return
    this.set({ recent: this.state.recent.map((r) => (r.key === key ? { ...r, ...patch } : r)) })
  }

  private enqueue(item: QueueItem) {
    this.set({ queue: [...this.state.queue, item] })
  }

  private canGoOnline() {
    return navigator.onLine && this.state.online
  }

  /** Antes de operar en línea, vacía la cola para no alterar el orden. */
  private async flushBeforeOnline() {
    if (this.state.queue.length > 0 && this.canGoOnline()) await this.syncInternal()
    return this.state.queue.length === 0 && this.canGoOnline()
  }

  // ---------- escaneo ----------
  scan(rawCode: string, mode: ScanMode, quantity: number): Promise<ScanOutcome> {
    return this.run(async () => {
      const barcode = normalizeBarcode(rawCode)
      if (!barcode) return { type: 'error', message: 'Código vacío' }
      if (!Number.isInteger(quantity) || quantity < 0 || (mode === 'add' && quantity === 0)) {
        return { type: 'error', message: 'Cantidad por escaneo inválida' }
      }
      const opId = crypto.randomUUID()

      if (await this.flushBeforeOnline()) {
        try {
          const { data, error } = await supabase.rpc('register_scan', {
            p_barcode: barcode,
            p_mode: mode,
            p_quantity: quantity,
            p_client_op_id: opId,
          })
          if (error) rpcError(error)
          const res = data as ScanRpcResult
          if (res.status === 'not_found') {
            if (this.state.products[barcode]) {
              const products = { ...this.state.products }
              delete products[barcode]
              this.set({ products })
            }
            return { type: 'not_found', barcode, offline: false }
          }
          return this.applyScanResult(res, opId, mode, quantity)
        } catch (e) {
          if (!isNetworkError(e) && !isAuthError(e)) return { type: 'error', message: errorMessage(e) }
          if (isNetworkError(e)) this.markOffline()
          // Se encola con el mismo opId: si sí llegó al servidor, no se duplica.
        }
      }
      return this.scanOffline(barcode, mode, quantity, opId)
    })
  }

  private applyScanResult(res: MovementResult, opId: string, mode: ScanMode, amount: number): ScanOutcome {
    this.markOnline()
    const product = toCached(res.product)
    this.putProduct(product)
    this.addRecent({
      key: opId,
      at: new Date().toISOString(),
      kind: 'scan',
      barcode: product.barcode,
      name: product.name,
      imagePath: product.image_url,
      mode,
      amount,
      delta: res.delta,
      quantityAfter: res.quantity_after,
      movementId: res.movement_id,
      pending: false,
      undone: false,
    })
    return { type: 'ok', product, delta: res.delta, quantityAfter: res.quantity_after, mode, pending: false }
  }

  private scanOffline(barcode: string, mode: ScanMode, quantity: number, opId: string): ScanOutcome {
    const cached = this.state.products[barcode]
    if (!cached) return { type: 'not_found', barcode, offline: true }
    const quantityAfter = mode === 'add' ? cached.quantity + quantity : quantity
    const delta = quantityAfter - cached.quantity
    const product = { ...cached, quantity: quantityAfter }
    this.enqueue({ kind: 'scan', opId, createdAt: new Date().toISOString(), barcode, mode, quantity })
    this.putProduct(product)
    this.addRecent({
      key: opId,
      at: new Date().toISOString(),
      kind: 'scan',
      barcode,
      name: cached.name,
      imagePath: cached.image_url,
      mode,
      amount: quantity,
      delta,
      quantityAfter,
      movementId: null,
      pending: true,
      undone: false,
    })
    return { type: 'ok', product, delta, quantityAfter, mode, pending: true }
  }

  // ---------- alta de producto ----------
  createProduct(raw: CreateInput, image: Blob | null): Promise<CreateOutcome> {
    return this.run(async () => {
      const input: CreateInput = {
        ...raw,
        barcode: raw.barcode ? normalizeBarcode(raw.barcode) || null : null,
        name: raw.name.trim(),
        category: raw.category?.trim() || null,
        supplier: raw.supplier?.trim() || null,
      }
      const opId = crypto.randomUUID()
      const online = await this.flushBeforeOnline()

      if (!input.barcode && !online) {
        return {
          type: 'error',
          message: 'Para generar un código interno (HCH-) se necesita conexión. Intenta cuando vuelva el internet.',
        }
      }

      let imageSkipped = false
      if (online) {
        let imagePath: string | null = null
        let networkFailed = false
        if (image) {
          try {
            imagePath = await uploadProductImage(image)
          } catch (e) {
            if (!isNetworkError(e)) return { type: 'error', message: `No se pudo subir la imagen: ${errorMessage(e)}` }
            networkFailed = true
            imageSkipped = true
          }
        }
        if (!networkFailed) {
          try {
            const res = await this.callCreate(input, imagePath, opId)
            return { ...res, pending: false, imageSkipped }
          } catch (e) {
            if (e instanceof PermanentError || (!isNetworkError(e) && !isAuthError(e))) {
              return { type: 'error', message: errorMessage(e) }
            }
          }
        }
        this.markOffline()
      } else if (image) {
        imageSkipped = true
      }

      // ----- sin conexión: encolar -----
      if (input.barcode && this.state.products[input.barcode]) {
        // Ya existe localmente: lo tratamos como escaneo "sumar" de la cantidad inicial.
        if (input.initialQuantity === 0) {
          const p = this.state.products[input.barcode]
          return { type: 'ok', product: p, quantityAfter: p.quantity, pending: false, existed: true, imageSkipped }
        }
        const out = this.scanOffline(input.barcode, 'add', input.initialQuantity, opId)
        if (out.type !== 'ok') return { type: 'error', message: 'No se pudo registrar' }
        return { type: 'ok', product: out.product, quantityAfter: out.quantityAfter, pending: true, existed: true, imageSkipped }
      }
      const tempBarcode = input.barcode ?? `HCH-pendiente-${opId.slice(0, 8)}`
      const product: CachedProduct = {
        id: `pending:${opId}`,
        barcode: tempBarcode,
        name: input.name,
        category: input.category,
        supplier: input.supplier,
        price: input.price,
        quantity: input.initialQuantity,
        image_url: null,
        is_internal_code: !input.barcode,
        pending: true,
      }
      this.enqueue({ kind: 'create', opId, createdAt: new Date().toISOString(), input, imagePath: null })
      this.putProduct(product)
      this.addRecent({
        key: opId,
        at: new Date().toISOString(),
        kind: 'create',
        barcode: tempBarcode,
        name: input.name,
        imagePath: null,
        mode: null,
        amount: input.initialQuantity,
        delta: input.initialQuantity,
        quantityAfter: input.initialQuantity,
        movementId: null,
        pending: true,
        undone: false,
      })
      return { type: 'ok', product, quantityAfter: input.initialQuantity, pending: true, existed: false, imageSkipped }
    })
  }

  /** Llama a create_product; si el código ya existía, suma la cantidad inicial. */
  private async callCreate(input: CreateInput, imagePath: string | null, opId: string) {
    const { data, error } = await supabase.rpc('create_product', {
      p_barcode: input.barcode,
      p_name: input.name,
      p_price: input.price,
      p_cost: input.cost,
      p_category: input.category,
      p_supplier: input.supplier,
      p_initial_quantity: input.initialQuantity,
      p_image_url: imagePath,
      p_client_op_id: opId,
    })
    if (error) {
      if (!isNetworkError(error) && !isAuthError(error)) throw new PermanentError(error.message)
      throw error
    }
    const res = data as CreateRpcResult
    this.markOnline()

    if (res.status === 'exists') {
      let product = toCached(res.product)
      let delta = 0
      let movementId: string | null = null
      if (input.initialQuantity > 0) {
        const scan = await supabase.rpc('register_scan', {
          p_barcode: product.barcode,
          p_mode: 'add',
          p_quantity: input.initialQuantity,
          p_client_op_id: opId,
          p_note: 'Alta repetida: el código ya existía, se sumó la cantidad inicial',
        })
        if (scan.error) {
          if (!isNetworkError(scan.error) && !isAuthError(scan.error)) throw new PermanentError(scan.error.message)
          throw scan.error
        }
        const sr = scan.data as ScanRpcResult
        if (sr.status === 'not_found') throw new PermanentError('El producto desapareció al sincronizar')
        product = toCached(sr.product)
        delta = sr.delta
        movementId = sr.movement_id
      }
      this.putServerProduct(product, opId, input.barcode ?? undefined)
      this.upsertRecentAfterSync(opId, product, delta, movementId, 'scan', input.initialQuantity)
      return { type: 'ok' as const, product, quantityAfter: product.quantity, existed: true }
    }

    const product = toCached(res.product)
    const pendingKey = input.barcode ?? this.findPendingBarcode(opId)
    this.putServerProduct(product, opId, pendingKey ?? undefined)
    this.upsertRecentAfterSync(opId, product, res.delta, res.movement_id, 'create', input.initialQuantity)
    return { type: 'ok' as const, product, quantityAfter: res.quantity_after, existed: false }
  }

  private findPendingBarcode(opId: string) {
    return Object.values(this.state.products).find((p) => p.id === `pending:${opId}`)?.barcode ?? null
  }

  private upsertRecentAfterSync(
    opId: string,
    product: CachedProduct,
    delta: number,
    movementId: string | null,
    kind: 'scan' | 'create',
    amount: number,
  ) {
    if (this.state.recent.some((r) => r.key === opId)) {
      this.patchRecent(opId, {
        barcode: product.barcode,
        name: product.name,
        imagePath: product.image_url,
        quantityAfter: product.quantity,
        delta,
        movementId,
        pending: false,
        // Si no hubo movimiento (cantidad 0 sobre código existente) no hay nada que deshacer.
        undone: movementId === null,
      })
      return
    }
    this.addRecent({
      key: opId,
      at: new Date().toISOString(),
      kind,
      barcode: product.barcode,
      name: product.name,
      imagePath: product.image_url,
      mode: kind === 'scan' ? 'add' : null,
      amount,
      delta,
      quantityAfter: product.quantity,
      movementId,
      pending: false,
      undone: movementId === null,
    })
  }

  // ---------- deshacer ----------
  undoLast(): Promise<UndoOutcome> {
    return this.run(async () => {
      const entry = this.state.recent.find((r) => !r.undone && !r.error)
      if (!entry) return { type: 'nothing' }

      // 1) Sigue en la cola: basta con quitarla y revertir lo optimista.
      if (entry.pending) {
        const queued = this.state.queue.find((q) => q.opId === entry.key)
        if (!queued) return { type: 'error', message: 'No se encontró la operación pendiente' }
        this.set({ queue: this.state.queue.filter((q) => q.opId !== entry.key) })
        const cached = this.state.products[entry.barcode]
        let quantityAfter = 0
        if (queued.kind === 'create' && cached?.pending) {
          const products = { ...this.state.products }
          delete products[entry.barcode]
          this.set({ products })
        } else if (cached) {
          quantityAfter = cached.quantity - entry.delta
          this.putProduct({ ...cached, quantity: quantityAfter })
        }
        this.patchRecent(entry.key, { undone: true })
        return { type: 'ok', entry, quantityAfter, pending: false }
      }

      if (!entry.movementId) return { type: 'error', message: 'Este movimiento no se puede deshacer' }
      const opId = crypto.randomUUID()

      // 2) Ya está en el servidor: undo_movement.
      if (await this.flushBeforeOnline()) {
        try {
          const { data, error } = await supabase.rpc('undo_movement', {
            p_movement_id: entry.movementId,
            p_client_op_id: opId,
          })
          if (error) rpcError(error)
          const res = data as MovementResult
          const product = toCached(res.product)
          this.putProduct(product)
          this.patchRecent(entry.key, { undone: true })
          this.markOnline()
          return { type: 'ok', entry, quantityAfter: product.quantity, pending: false }
        } catch (e) {
          if (!isNetworkError(e) && !isAuthError(e)) return { type: 'error', message: errorMessage(e) }
          if (isNetworkError(e)) this.markOffline()
        }
      }

      // 3) Sin conexión: encolar el "deshacer".
      this.enqueue({ kind: 'undo', opId, createdAt: new Date().toISOString(), movementId: entry.movementId, barcode: entry.barcode })
      const cached = this.state.products[entry.barcode]
      const quantityAfter = (cached?.quantity ?? 0) - entry.delta
      if (cached) this.putProduct({ ...cached, quantity: quantityAfter })
      this.patchRecent(entry.key, { undone: true })
      return { type: 'ok', entry, quantityAfter, pending: true }
    })
  }

  // ---------- sincronización ----------
  syncNow() {
    return this.run(() => this.syncInternal())
  }

  private async syncInternal() {
    if (this.state.queue.length === 0 || this.state.syncing) return
    if (!navigator.onLine) return this.markOffline()

    const { data, error } = await supabase.auth.getSession()
    if (error) {
      if (isNetworkError(error)) this.markOffline()
      return
    }
    if (!data.session) {
      this.set({ syncError: 'Inicia sesión para sincronizar las operaciones pendientes.' })
      return
    }

    this.set({ syncing: true, syncError: null })
    let refreshedOnce = false
    try {
      while (this.state.queue.length > 0) {
        const item = this.state.queue[0]
        try {
          await this.applyQueued(item)
          this.set({ queue: this.state.queue.slice(1) })
          this.markOnline()
        } catch (e) {
          if (isNetworkError(e)) {
            this.markOffline()
            break
          }
          if (isAuthError(e) && !refreshedOnce) {
            refreshedOnce = true
            const r = await supabase.auth.refreshSession()
            if (r.error) {
              if (isNetworkError(r.error)) this.markOffline()
              else this.set({ syncError: 'La sesión expiró. Inicia sesión de nuevo para sincronizar.' })
              break
            }
            continue
          }
          if (isAuthError(e)) {
            this.set({ syncError: 'La sesión expiró. Inicia sesión de nuevo para sincronizar.' })
            break
          }
          // Error permanente: se aparta para revisión y se sigue con lo demás.
          const message = errorMessage(e)
          this.set({
            queue: this.state.queue.slice(1),
            failed: [...this.state.failed, { item, error: message, at: new Date().toISOString() }],
          })
          this.patchRecent(item.opId, { pending: false, error: message })
        }
      }
    } finally {
      this.set({ syncing: false })
    }
  }

  private async applyQueued(item: QueueItem) {
    if (item.kind === 'scan') {
      const { data, error } = await supabase.rpc('register_scan', {
        p_barcode: item.barcode,
        p_mode: item.mode,
        p_quantity: item.quantity,
        p_client_op_id: item.opId,
        p_note: 'Sincronizado desde la cola sin conexión',
      })
      if (error) {
        if (!isNetworkError(error) && !isAuthError(error)) throw new PermanentError(error.message)
        throw error
      }
      const res = data as ScanRpcResult
      if (res.status === 'not_found') {
        throw new PermanentError(`El código ${item.barcode} no existe en la base de datos`)
      }
      this.putServerProduct(toCached(res.product), item.opId)
      this.patchRecent(item.opId, { movementId: res.movement_id, pending: false })
      return
    }
    if (item.kind === 'create') {
      await this.callCreate(item.input, item.imagePath, item.opId)
      return
    }
    const { data, error } = await supabase.rpc('undo_movement', {
      p_movement_id: item.movementId,
      p_client_op_id: item.opId,
    })
    if (error) {
      if (!isNetworkError(error) && !isAuthError(error)) throw new PermanentError(error.message)
      throw error
    }
    this.putServerProduct(toCached((data as MovementResult).product), item.opId)
  }

  dismissFailed(index: number) {
    this.set({ failed: this.state.failed.filter((_, i) => i !== index) })
  }

  /** Al cerrar sesión: se conserva la cola (se sincroniza con el siguiente login). */
  clearSessionData() {
    this.set({ recent: [] })
  }
}

export const inventoryStore = new InventoryStore()
