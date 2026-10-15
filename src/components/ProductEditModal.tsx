import { useEffect, useRef, useState, type FormEvent } from 'react'
import { compressImage } from '../lib/images'
import { formatInt, parseMoney } from '../lib/format'
import { getProduct, updateProduct } from '../lib/products'
import { isNetworkError } from '../lib/supabase'
import type { Product } from '../lib/types'
import { CategorySelect } from './CategorySelect'
import { Icon } from './Icon'
import { ProductImage } from './ProductImage'
import { WebcamCapture } from './WebcamCapture'

interface Props {
  productId: string
  /** Proveedores ya usados (sugerencias). */
  suppliers: string[]
  onCancel: () => void
  onSaved: (product: Product) => void
}

type Fields = { name: string; price: string; cost: string; category: string; supplier: string; description: string }

const moneyText = (n: number | null) => (n == null ? '' : String(n))

/**
 * Editar un producto: nombre, precios, categoría, proveedor, descripción y
 * foto. El código y la cantidad no se editan aquí (la cantidad cambia con
 * escaneos y ventas, para que quede en el historial).
 */
export function ProductEditModal({ productId, suppliers, onCancel, onSaved }: Props) {
  const [product, setProduct] = useState<Product | null>(null)
  const [fields, setFields] = useState<Fields | null>(null)
  // undefined = sin cambios; null = quitar; Blob = foto nueva.
  const [image, setImage] = useState<Blob | null | undefined>(undefined)
  const [preview, setPreview] = useState<string | null>(null)
  const [camera, setCamera] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getProduct(productId)
      .then((p) => {
        if (!p) return setError('No se encontró el producto.')
        setProduct(p)
        setFields({
          name: p.name,
          price: moneyText(p.price),
          cost: moneyText(p.cost),
          category: p.category ?? '',
          supplier: p.supplier ?? '',
          description: p.description ?? '',
        })
        setTimeout(() => nameRef.current?.focus(), 0)
      })
      .catch((e) => setError(isNetworkError(e) ? 'Sin conexión: editar un producto necesita internet.' : (e as Error).message))
  }, [productId])

  useEffect(() => {
    if (!image) return setPreview(null)
    const url = URL.createObjectURL(image)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [image])

  const set = (key: keyof Fields) => (e: { target: { value: string } }) =>
    setFields((f) => (f ? { ...f, [key]: e.target.value } : f))

  async function setImageFrom(blob: Blob) {
    try {
      setImage(await compressImage(blob))
      setCamera(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo procesar la imagen')
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (saving || !fields || !product) return
    setError(null)
    const name = fields.name.trim()
    const price = parseMoney(fields.price)
    const cost = parseMoney(fields.cost)
    if (!name) return setError('El nombre es obligatorio.')
    if (price === null || Number.isNaN(price)) return setError('El precio de venta es obligatorio y debe ser un número válido.')
    if (Number.isNaN(cost)) return setError('El costo debe ser un número válido.')
    setSaving(true)
    try {
      const saved = await updateProduct(
        product.id,
        { name, price, cost, category: fields.category, supplier: fields.supplier, description: fields.description },
        image,
      )
      onSaved(saved)
    } catch (err) {
      setError(isNetworkError(err) ? 'Sin conexión: no se guardaron los cambios.' : (err as Error).message)
      setSaving(false)
    }
  }

  const input = 'field h-10'
  const label = 'field-label'
  const currentImage = image === undefined ? product?.image_url : null

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="pe-title">
      <form
        noValidate
        onSubmit={onSubmit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        className="max-h-full w-full max-w-2xl overflow-auto rounded-lg border border-line bg-surface shadow-popover"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <h2 id="pe-title" className="text-title">Editar producto</h2>
            {product && (
              <p className="mt-1 text-ink-muted">
                Código: <span className="font-mono text-ink">{product.barcode}</span> · Stock:{' '}
                <span className="text-ink tabular-nums">{formatInt(product.quantity)}</span>
              </p>
            )}
          </div>
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            <Icon name="x" />
            Cancelar (Esc)
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {!fields && !error && <p className="py-6 text-center text-ink-subtle">Cargando producto…</p>}

          {fields && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className={label} htmlFor="pe-name">Nombre *</label>
                <input id="pe-name" ref={nameRef} className={input} value={fields.name} onChange={set('name')} autoComplete="off" />
              </div>
              <div>
                <label className={label} htmlFor="pe-price">Precio de venta * ($)</label>
                <input id="pe-price" className={`${input} tabular-nums`} value={fields.price} onChange={set('price')} inputMode="decimal" autoComplete="off" />
              </div>
              <div>
                <label className={label} htmlFor="pe-cost">Costo ($)</label>
                <input id="pe-cost" className={`${input} tabular-nums`} value={fields.cost} onChange={set('cost')} inputMode="decimal" autoComplete="off" />
              </div>
              <div>
                <label className={label} htmlFor="pe-category">Categoría</label>
                <CategorySelect id="pe-category" value={fields.category} onChange={(category) => setFields((f) => (f ? { ...f, category } : f))} />
              </div>
              <div>
                <label className={label} htmlFor="pe-supplier">Proveedor</label>
                <input id="pe-supplier" className={input} value={fields.supplier} onChange={set('supplier')} list="pe-suppliers" autoComplete="off" />
                <datalist id="pe-suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
              </div>
              <div className="md:col-span-2">
                <label className={label} htmlFor="pe-description">Descripción</label>
                <textarea id="pe-description" rows={3} className="field h-auto py-2" value={fields.description} onChange={set('description')} />
              </div>
              <div className="md:col-span-2">
                <span className={label}>Imagen</span>
                <div className="flex flex-wrap items-start gap-4">
                  {preview ? (
                    <img src={preview} alt="Vista previa" className="size-28 rounded-md border border-line object-contain" />
                  ) : (
                    <ProductImage path={currentImage ?? null} alt="" className="size-28 rounded-md" />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <label className="btn btn-secondary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus-ring">
                      <Icon name="upload" />
                      Subir archivo
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) void setImageFrom(f)
                          e.target.value = ''
                        }}
                      />
                    </label>
                    <button type="button" onClick={() => setCamera(true)} className="btn btn-secondary">
                      <Icon name="camera" />
                      Usar cámara
                    </button>
                    {(preview || currentImage) && (
                      <button type="button" onClick={() => setImage(null)} className="btn btn-danger">
                        Quitar
                      </button>
                    )}
                    {image !== undefined && (
                      <button type="button" onClick={() => setImage(undefined)} className="btn btn-ghost">
                        Deshacer cambio de foto
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {camera && <WebcamCapture onCapture={(b) => void setImageFrom(b)} onClose={() => setCamera(false)} />}

          {error && (
            <p className="notice bg-danger-bg text-danger-fg">
              <Icon name="alert" className="mt-0.5" />
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-line bg-subtle px-6 py-4">
          <button type="submit" disabled={saving || !fields} className="btn btn-primary btn-lg w-full sm:w-auto">
            <Icon name="check" size={20} />
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  )
}
