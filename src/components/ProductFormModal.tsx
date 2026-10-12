import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { compressImage } from '../lib/images'
import { parseCount, parseMoney } from '../lib/format'
import { createBurstDetector } from '../lib/scannerBurst'
import { inventoryStore, type CreateOutcome } from '../store/inventoryStore'
import { useInventory } from '../store/useInventory'
import { WebcamCapture } from './WebcamCapture'

interface Props {
  /** null = producto sin código (se genera HCH- al guardar). */
  barcode: string | null
  defaultQuantity: number
  onCancel: () => void
  onSaved: (outcome: Extract<CreateOutcome, { type: 'ok' }>) => void
}

type Fields = {
  name: string
  price: string
  cost: string
  category: string
  supplier: string
  quantity: string
}

export function ProductFormModal({ barcode, defaultQuantity, onCancel, onSaved }: Props) {
  const { products, online } = useInventory()
  const [fields, setFields] = useState<Fields>({
    name: '',
    price: '',
    cost: '',
    category: '',
    supplier: '',
    quantity: String(defaultQuantity),
  })
  const [image, setImage] = useState<Blob | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [camera, setCamera] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const detector = useRef(createBurstDetector())

  useEffect(() => nameRef.current?.focus(), [])

  useEffect(() => {
    if (!image) return setPreview(null)
    const url = URL.createObjectURL(image)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [image])

  const { categories, suppliers } = useMemo(() => {
    const c = new Set<string>()
    const s = new Set<string>()
    for (const p of Object.values(products)) {
      if (p.category) c.add(p.category)
      if (p.supplier) s.add(p.supplier)
    }
    return { categories: [...c].sort(), suppliers: [...s].sort() }
  }, [products])

  const set = (key: keyof Fields) => (e: { target: { value: string } }) =>
    setFields((f) => ({ ...f, [key]: e.target.value }))

  async function setImageFrom(blob: Blob) {
    try {
      setImage(await compressImage(blob))
      setCamera(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo procesar la imagen')
    }
  }

  // Si el lector "teclea" un código dentro del formulario, no guardamos basura.
  function onKeyDownCapture(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
      return
    }
    const scanned = detector.current.handle(e)
    if (!scanned) return
    e.preventDefault()
    const target = e.target as HTMLInputElement
    const key = target.name as keyof Fields
    if (key in fields) {
      setFields((f) => ({ ...f, [key]: f[key].endsWith(scanned) ? f[key].slice(0, -scanned.length) : f[key] }))
    }
    setWarning(`Se detectó un escaneo (${scanned}) dentro del formulario y se ignoró. Termina de capturar este producto primero.`)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    setError(null)
    const name = fields.name.trim()
    const price = parseMoney(fields.price)
    const cost = parseMoney(fields.cost)
    const quantity = parseCount(fields.quantity || '0')
    if (!name) return setError('El nombre es obligatorio.')
    if (price === null || Number.isNaN(price)) return setError('El precio de venta es obligatorio y debe ser un número válido.')
    if (Number.isNaN(cost)) return setError('El costo debe ser un número válido.')
    if (Number.isNaN(quantity)) return setError('La cantidad inicial debe ser un número entero (0 o más).')

    setSaving(true)
    const outcome = await inventoryStore.createProduct(
      { barcode, name, price, cost, category: fields.category, supplier: fields.supplier, initialQuantity: quantity },
      image,
    )
    setSaving(false)
    if (outcome.type === 'error') return setError(outcome.message)
    onSaved(outcome)
  }

  const input =
    'w-full rounded-lg border-2 border-slate-400 bg-white px-3 py-2 text-xl focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-200'
  const label = 'mb-1 block text-base font-bold text-slate-700'

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/70 p-4" role="dialog" aria-modal="true">
      <form
        onSubmit={onSubmit}
        onKeyDownCapture={onKeyDownCapture}
        className="max-h-full w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-3xl font-black">Producto nuevo</h2>
            <p className="mt-1 text-xl">
              Código:{' '}
              <span className="font-mono font-bold">
                {barcode ?? 'se generará un código interno HCH- al guardar'}
              </span>
            </p>
            {!online && (
              <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2 font-semibold text-amber-900">
                Sin conexión: el producto se guardará en la cola y se sincronizará después (sin imagen).
              </p>
            )}
          </div>
          <button type="button" onClick={onCancel} className="rounded-lg bg-slate-200 px-4 py-2 text-lg font-bold hover:bg-slate-300">
            Cancelar (Esc)
          </button>
        </div>

        {warning && <p className="mb-4 rounded-lg bg-amber-200 p-3 text-lg font-bold text-amber-950">{warning}</p>}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className={label} htmlFor="pf-name">Nombre *</label>
            <input id="pf-name" name="name" ref={nameRef} className={input} value={fields.name} onChange={set('name')} autoComplete="off" />
          </div>
          <div>
            <label className={label} htmlFor="pf-price">Precio de venta * ($)</label>
            <input id="pf-price" name="price" className={input} value={fields.price} onChange={set('price')} inputMode="decimal" autoComplete="off" />
          </div>
          <div>
            <label className={label} htmlFor="pf-cost">Costo ($)</label>
            <input id="pf-cost" name="cost" className={input} value={fields.cost} onChange={set('cost')} inputMode="decimal" autoComplete="off" />
          </div>
          <div>
            <label className={label} htmlFor="pf-category">Categoría</label>
            <input id="pf-category" name="category" className={input} value={fields.category} onChange={set('category')} list="pf-categories" autoComplete="off" />
            <datalist id="pf-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div>
            <label className={label} htmlFor="pf-supplier">Proveedor</label>
            <input id="pf-supplier" name="supplier" className={input} value={fields.supplier} onChange={set('supplier')} list="pf-suppliers" autoComplete="off" />
            <datalist id="pf-suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
          <div>
            <label className={label} htmlFor="pf-qty">Cantidad inicial</label>
            <input id="pf-qty" name="quantity" className={input} value={fields.quantity} onChange={set('quantity')} inputMode="numeric" autoComplete="off" />
          </div>
          <div>
            <span className={label}>Imagen (opcional)</span>
            <div className="flex flex-wrap gap-2">
              <label className="cursor-pointer rounded-lg bg-slate-700 px-4 py-2 text-lg font-bold text-white hover:bg-slate-800">
                Subir archivo
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void setImageFrom(f)
                    e.target.value = ''
                  }}
                />
              </label>
              <button type="button" onClick={() => setCamera(true)} className="rounded-lg bg-slate-700 px-4 py-2 text-lg font-bold text-white hover:bg-slate-800">
                Usar cámara
              </button>
              {image && (
                <button type="button" onClick={() => setImage(null)} className="rounded-lg bg-red-100 px-4 py-2 text-lg font-bold text-red-800 hover:bg-red-200">
                  Quitar
                </button>
              )}
            </div>
          </div>
        </div>

        {camera && (
          <div className="mt-4">
            <WebcamCapture onCapture={(b) => void setImageFrom(b)} onClose={() => setCamera(false)} />
          </div>
        )}
        {preview && <img src={preview} alt="Vista previa" className="mt-4 max-h-48 rounded-lg border-2 border-slate-300" />}

        {error && <p className="mt-4 rounded-lg bg-red-100 p-3 text-lg font-bold text-red-800">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="mt-6 w-full rounded-xl bg-blue-700 py-4 text-2xl font-black text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar producto (Enter)'}
        </button>
      </form>
    </div>
  )
}
