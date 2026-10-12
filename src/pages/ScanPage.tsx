import { useCallback, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ProductFormModal } from '../components/ProductFormModal'
import { ProductImage } from '../components/ProductImage'
import { useKeepFocus } from '../components/useKeepFocus'
import { isInternalCode, normalizeBarcode } from '../lib/barcode'
import { exportCsv, exportXlsx, buildInventoryRows } from '../lib/export'
import { formatInt, parseCount } from '../lib/format'
import { createBurstDetector } from '../lib/scannerBurst'
import { sounds } from '../lib/sounds'
import type { ScanMode } from '../lib/types'
import { inventoryStore, type CachedProduct } from '../store/inventoryStore'
import { useInventory } from '../store/useInventory'

type Feedback =
  | { kind: 'success' | 'pending' | 'created' | 'undo'; title: string; product: Pick<CachedProduct, 'name' | 'barcode' | 'image_url'>; quantityAfter: number; detail: string; note?: string }
  | { kind: 'error'; title: string; detail?: string }
  | { kind: 'idle' }

const STYLES: Record<Feedback['kind'], string> = {
  idle: 'bg-white border-slate-300 text-slate-500',
  success: 'bg-emerald-600 border-emerald-800 text-white',
  pending: 'bg-amber-400 border-amber-600 text-slate-950',
  created: 'bg-blue-700 border-blue-900 text-white',
  undo: 'bg-violet-700 border-violet-900 text-white',
  error: 'bg-red-600 border-red-800 text-white',
}

function loadPref(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* no crítico */
  }
}

export function ScanPage() {
  const { products, recent, online } = useInventory()
  const [code, setCode] = useState('')
  const [mode, setModeState] = useState<ScanMode>(() => (loadPref('hachiko.mode', 'add') === 'set' ? 'set' : 'add'))
  const [qtyText, setQtyText] = useState(() => loadPref('hachiko.qty', '1'))
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'idle' })
  const [modal, setModal] = useState<{ barcode: string | null; defaultQuantity: number } | null>(null)
  const [exporting, setExporting] = useState(false)
  const scanRef = useRef<HTMLInputElement>(null)
  const qtyRef = useRef<HTMLInputElement>(null)
  const lastValidQty = useRef(qtyText)
  const qtyIdle = useRef<number | undefined>(undefined)
  const qtyDetector = useRef(createBurstDetector())

  useKeepFocus(scanRef, modal === null)

  const focusScan = useCallback(() => setTimeout(() => scanRef.current?.focus(), 0), [])

  const quantity = parseCount(qtyText, mode === 'add' ? 1 : 0)
  const qtyValid = !Number.isNaN(quantity)

  const totals = useMemo(() => {
    let pieces = 0
    const list = Object.values(products)
    for (const p of list) pieces += p.quantity
    return { products: list.length, pieces }
  }, [products])

  function setMode(m: ScanMode) {
    setModeState(m)
    savePref('hachiko.mode', m)
    focusScan()
  }

  function updateQty(text: string) {
    setQtyText(text)
    if (/^\d+$/.test(text.trim())) {
      lastValidQty.current = text.trim()
      savePref('hachiko.qty', text.trim())
    }
    // Si se deja el campo de cantidad sin tocar, el foco regresa al escaneo.
    window.clearTimeout(qtyIdle.current)
    qtyIdle.current = window.setTimeout(() => {
      if (document.activeElement === qtyRef.current) scanRef.current?.focus()
    }, 4000)
  }

  async function processScan(raw: string) {
    const barcode = normalizeBarcode(raw)
    if (!barcode) return
    if (!qtyValid) {
      sounds.error()
      setFeedback({
        kind: 'error',
        title: 'Cantidad por escaneo inválida',
        detail: mode === 'add' ? 'Debe ser un número entero mayor o igual a 1.' : 'Debe ser un número entero (0 o más).',
      })
      return
    }
    const out = await inventoryStore.scan(barcode, mode, quantity)
    if (out.type === 'error') {
      sounds.error()
      setFeedback({ kind: 'error', title: 'No se pudo registrar el escaneo', detail: out.message })
      return
    }
    if (out.type === 'not_found') {
      sounds.newProduct()
      setFeedback({ kind: 'idle' })
      setModal({ barcode: out.barcode, defaultQuantity: quantity })
      return
    }
    if (out.pending) sounds.pending()
    else sounds.success()
    setFeedback({
      kind: out.pending ? 'pending' : 'success',
      title: out.pending ? 'Guardado sin conexión (pendiente)' : out.mode === 'add' ? 'Sumado' : 'Total fijado',
      product: out.product,
      quantityAfter: out.quantityAfter,
      detail: out.mode === 'add' ? `+${formatInt(out.delta)}` : `Fijado en ${formatInt(out.quantityAfter)} (${out.delta >= 0 ? '+' : ''}${formatInt(out.delta)})`,
    })
  }

  function onScanSubmit(e: FormEvent) {
    e.preventDefault()
    const value = code
    setCode('')
    if (value.trim()) void processScan(value)
  }

  // Si el lector escribe dentro de "Cantidad por escaneo", se trata como escaneo.
  function onQtyKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const scanned = qtyDetector.current.handle(e)
    if (scanned) {
      e.preventDefault()
      setQtyText(lastValidQty.current)
      scanRef.current?.focus()
      void processScan(scanned)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      scanRef.current?.focus()
    }
  }

  async function undo() {
    const out = await inventoryStore.undoLast()
    focusScan()
    if (out.type === 'nothing') {
      sounds.error()
      setFeedback({ kind: 'error', title: 'No hay escaneos para deshacer en esta sesión' })
      return
    }
    if (out.type === 'error') {
      sounds.error()
      setFeedback({ kind: 'error', title: 'No se pudo deshacer', detail: out.message })
      return
    }
    sounds.success()
    setFeedback({
      kind: 'undo',
      title: out.pending ? 'Deshecho (pendiente de sincronizar)' : 'Escaneo deshecho',
      product: { name: out.entry.name, barcode: out.entry.barcode, image_url: out.entry.imagePath },
      quantityAfter: out.quantityAfter,
      detail: `${out.entry.delta >= 0 ? '−' : '+'}${formatInt(Math.abs(out.entry.delta))}`,
    })
  }

  async function doExport(kind: 'csv' | 'xlsx') {
    if (exporting) return
    setExporting(true)
    try {
      const rows = await buildInventoryRows()
      if (kind === 'csv') exportCsv(rows, 'inventario-hachiko')
      else await exportXlsx(rows, 'inventario-hachiko', 'Inventario')
    } catch (e) {
      sounds.error()
      setFeedback({
        kind: 'error',
        title: 'No se pudo exportar',
        detail: online ? (e as Error).message : 'Se necesita conexión para exportar.',
      })
    } finally {
      setExporting(false)
      focusScan()
    }
  }

  const bigBtn = 'rounded-xl px-5 py-4 text-xl font-black shadow-sm disabled:opacity-40'

  return (
    <div className="grid h-full gap-5 p-5 lg:grid-cols-[1fr_380px]">
      <section className="flex min-w-0 flex-col gap-5">
        {/* Escaneo */}
        <form onSubmit={onScanSubmit} className="rounded-2xl bg-white p-5 shadow">
          <label htmlFor="scan" className="mb-2 block text-xl font-bold text-slate-700">
            Escanea o escribe el código y presiona Enter
          </label>
          <input
            id="scan"
            ref={scanRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="w-full rounded-xl border-4 border-slate-900 px-5 py-4 font-mono text-4xl tracking-wider focus:border-blue-600 focus:outline-none focus:ring-8 focus:ring-blue-200"
            placeholder="Código de barras…"
          />
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <div data-keep-focus>
              <label htmlFor="qty" className="mb-1 block text-base font-bold text-slate-700">
                {mode === 'add' ? 'Cantidad por escaneo' : 'Total a fijar'}
              </label>
              <input
                id="qty"
                ref={qtyRef}
                value={qtyText}
                onChange={(e) => updateQty(e.target.value)}
                onKeyDown={onQtyKeyDown}
                onFocus={(e) => e.target.select()}
                onBlur={() => !qtyValid && setQtyText(lastValidQty.current)}
                inputMode="numeric"
                autoComplete="off"
                className={`w-36 rounded-xl border-4 px-4 py-2 text-center text-3xl font-black focus:outline-none ${qtyValid ? 'border-slate-400 focus:border-blue-600' : 'border-red-600 bg-red-50'}`}
              />
            </div>
            <div className="flex overflow-hidden rounded-xl border-4 border-slate-900" role="group" aria-label="Modo">
              <button
                type="button"
                onClick={() => setMode('add')}
                className={`px-6 py-3 text-xl font-black ${mode === 'add' ? 'bg-slate-900 text-white' : 'bg-white text-slate-900'}`}
              >
                Sumar
              </button>
              <button
                type="button"
                onClick={() => setMode('set')}
                className={`px-6 py-3 text-xl font-black ${mode === 'set' ? 'bg-orange-600 text-white' : 'bg-white text-slate-900'}`}
              >
                Fijar total
              </button>
            </div>
            {mode === 'set' && (
              <p className="rounded-lg bg-orange-100 px-3 py-2 text-lg font-bold text-orange-900">
                Modo FIJAR TOTAL: cada escaneo deja la cantidad en {qtyValid ? formatInt(quantity) : '…'}
              </p>
            )}
          </div>
        </form>

        {/* Confirmación grande */}
        <div className={`flex min-h-64 flex-1 items-center gap-6 rounded-2xl border-4 p-6 ${STYLES[feedback.kind]}`} aria-live="polite">
          {feedback.kind === 'idle' && <p className="w-full text-center text-3xl font-bold">Listo para escanear</p>}
          {feedback.kind === 'error' && (
            <div>
              <p className="text-4xl font-black">✕ {feedback.title}</p>
              {feedback.detail && <p className="mt-2 text-2xl">{feedback.detail}</p>}
            </div>
          )}
          {(feedback.kind === 'success' || feedback.kind === 'pending' || feedback.kind === 'created' || feedback.kind === 'undo') && (
            <>
              <ProductImage path={feedback.product.image_url} alt={feedback.product.name} className="h-48 w-48 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <p className="text-2xl font-bold uppercase opacity-90">{feedback.title}</p>
                <p className="truncate text-5xl font-black" title={feedback.product.name}>{feedback.product.name}</p>
                <p className="mt-1 font-mono text-2xl opacity-90">{feedback.product.barcode}</p>
                <div className="mt-3 flex items-baseline gap-6">
                  <span className="text-7xl font-black">{formatInt(feedback.quantityAfter)}</span>
                  <span className="text-3xl font-bold opacity-90">pzas · {feedback.detail}</span>
                </div>
                {feedback.note && <p className="mt-2 text-xl font-semibold">{feedback.note}</p>}
                {feedback.kind === 'created' && isInternalCode(feedback.product.barcode) && (
                  <button
                    type="button"
                    onClick={() => window.open(`/etiqueta/${encodeURIComponent(feedback.product.barcode)}?print=1`, '_blank')}
                    className="mt-4 rounded-xl bg-white px-6 py-3 text-2xl font-black text-blue-800 hover:bg-blue-50"
                  >
                    🖨 Imprimir etiqueta
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Acciones */}
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => void undo()} className={`${bigBtn} bg-violet-700 text-white hover:bg-violet-800`}>
            ↶ Deshacer último escaneo
          </button>
          <button
            type="button"
            onClick={() => {
              setFeedback({ kind: 'idle' })
              setModal({ barcode: null, defaultQuantity: qtyValid && quantity > 0 ? quantity : 1 })
            }}
            disabled={!online}
            title={online ? undefined : 'Se necesita conexión para generar un código interno'}
            className={`${bigBtn} bg-blue-700 text-white hover:bg-blue-800`}
          >
            + Producto sin código
          </button>
          <div className="ml-auto flex gap-3">
            <button type="button" onClick={() => void doExport('csv')} disabled={exporting || !online} className={`${bigBtn} bg-white text-slate-900 ring-4 ring-slate-900 hover:bg-slate-50`}>
              Exportar CSV
            </button>
            <button type="button" onClick={() => void doExport('xlsx')} disabled={exporting || !online} className={`${bigBtn} bg-emerald-700 text-white hover:bg-emerald-800`}>
              {exporting ? 'Exportando…' : 'Exportar Excel'}
            </button>
          </div>
        </div>
      </section>

      {/* Lateral: contadores y últimos escaneos */}
      <aside className="flex min-h-0 flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-slate-900 p-4 text-white">
            <p className="text-base font-bold uppercase text-slate-300">Productos distintos</p>
            <p className="text-5xl font-black">{formatInt(totals.products)}</p>
          </div>
          <div className="rounded-2xl bg-slate-900 p-4 text-white">
            <p className="text-base font-bold uppercase text-slate-300">Piezas totales</p>
            <p className="text-5xl font-black">{formatInt(totals.pieces)}</p>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col rounded-2xl bg-white p-4 shadow">
          <h2 className="mb-3 text-xl font-black">Últimos escaneos de esta sesión</h2>
          {recent.length === 0 && <p className="text-lg text-slate-500">Aún no hay escaneos.</p>}
          <ul className="min-h-0 flex-1 space-y-2 overflow-auto">
            {recent.map((r) => (
              <li
                key={r.key}
                className={`flex items-center gap-3 rounded-xl border-2 p-2 ${r.undone ? 'border-slate-200 opacity-50' : r.error ? 'border-red-400 bg-red-50' : r.pending ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`}
              >
                <ProductImage path={r.imagePath} alt={r.name} className="h-12 w-12 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-lg font-bold ${r.undone ? 'line-through' : ''}`}>{r.name}</p>
                  <p className="truncate font-mono text-sm text-slate-600">
                    {r.barcode} · {new Date(r.at).toLocaleTimeString('es-MX')}
                  </p>
                  {r.pending && !r.undone && <p className="text-sm font-bold text-amber-700">Pendiente de sincronizar</p>}
                  {r.error && <p className="text-sm font-bold text-red-700">Error: {r.error}</p>}
                  {r.undone && r.movementId && <p className="text-sm font-bold text-slate-600">Deshecho</p>}
                </div>
                <div className="text-right">
                  <p className="text-xl font-black">
                    {r.kind === 'create' ? 'Alta' : r.mode === 'set' ? '=' : '+'}
                    {r.kind === 'create' || r.mode === 'add' ? formatInt(r.amount) : formatInt(r.quantityAfter)}
                  </p>
                  <p className="text-sm text-slate-600">total {formatInt(r.quantityAfter)}</p>
                  {isInternalCode(r.barcode) && !r.undone && (
                    <button
                      type="button"
                      onClick={() => window.open(`/etiqueta/${encodeURIComponent(r.barcode)}?print=1`, '_blank')}
                      className="mt-1 rounded bg-slate-200 px-2 py-0.5 text-sm font-bold hover:bg-slate-300"
                    >
                      Etiqueta
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {modal && (
        <ProductFormModal
          barcode={modal.barcode}
          defaultQuantity={modal.defaultQuantity}
          onCancel={() => {
            setModal(null)
            focusScan()
          }}
          onSaved={(out) => {
            setModal(null)
            focusScan()
            sounds.success()
            const notes: string[] = []
            if (out.existed) notes.push('El código ya existía: se sumó la cantidad inicial.')
            if (out.imageSkipped) notes.push('La imagen no se guardó por falta de conexión.')
            setFeedback({
              kind: out.pending ? 'pending' : 'created',
              title: out.pending ? 'Producto guardado sin conexión (pendiente)' : out.existed ? 'Producto existente' : 'Producto dado de alta',
              product: out.product,
              quantityAfter: out.quantityAfter,
              detail: out.existed ? 'cantidad sumada' : 'conteo inicial',
              note: notes.join(' ') || undefined,
            })
          }}
        />
      )}
    </div>
  )
}
