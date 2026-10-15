import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { compressImage } from '../lib/images'
import { formatInt, parseCount, parseMoney } from '../lib/format'
import { adjustStock, getCatalogName, getProduct, unlinkProduct, updateProduct } from '../lib/products'
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
  /** Cambios que se aplican al momento (ajuste de existencias, desvincular). */
  onChanged: (product: Product, oldBarcode?: string) => void
}

type Fields = { name: string; price: string; cost: string; category: string; supplier: string; description: string }

const moneyText = (n: number | null) => (n == null ? '' : String(n))

/**
 * Editar un producto: nombre, precios, categoría, proveedor, descripción y
 * foto. El código y la cantidad no se editan aquí (la cantidad cambia con
 * escaneos y ventas, para que quede en el historial).
 */
export function ProductEditModal({ productId, suppliers, onCancel, onSaved, onChanged }: Props) {
  const [product, setProduct] = useState<Product | null>(null)
  const [fields, setFields] = useState<Fields | null>(null)
  // undefined = sin cambios; null = quitar; Blob = foto nueva.
  const [image, setImage] = useState<Blob | null | undefined>(undefined)
  const [preview, setPreview] = useState<string | null>(null)
  const [camera, setCamera] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const [catalogName, setCatalogName] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

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
        if (p.catalog_product_id != null) void getCatalogName(p.catalog_product_id).then(setCatalogName)
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

  /** Ajuste o desvinculado ya guardado: refleja el producto sin cerrar el formulario. */
  function applied(p: Product, message: string) {
    const oldBarcode = product?.barcode
    setProduct(p)
    if (p.catalog_product_id == null) setCatalogName(null)
    setDone(message)
    onChanged(p, oldBarcode)
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

          {product && fields && (
            <>
              {done && (
                <p className="notice bg-success-bg text-success-fg" role="status">
                  <Icon name="check" className="mt-0.5" />
                  {done}
                </p>
              )}
              <CorrectionSection
                title="Existencias"
                summary={
                  <>
                    Stock actual: <span className="font-medium text-ink tabular-nums">{formatInt(product.quantity)}</span>
                  </>
                }
                action="Ajustar existencias"
                valueLabel="Cantidad correcta"
                placeholder="Ej. 3"
                reasonPlaceholder="Ej. Se escaneó de más / merma / producto dañado"
                confirm="Aplicar ajuste"
                run={async (value, reason) => {
                  const qty = parseCount(value)
                  if (Number.isNaN(qty)) throw new Error('La cantidad debe ser un número entero (0 o más).')
                  const p = await adjustStock(product.id, qty, reason)
                  applied(p, `Existencias ajustadas a ${formatInt(p.quantity)}. Quedó en el historial.`)
                }}
              />
              <CorrectionSection
                title="Código de barras y catálogo"
                summary={
                  <>
                    {product.is_internal_code ? 'Código interno ' : 'Código '}
                    <span className="font-mono text-ink">{product.barcode}</span>
                    {product.catalog_product_id != null && (
                      <>
                        {' '}
                        · Vinculado al catálogo: <span className="text-ink">{catalogName ?? `#${product.catalog_product_id}`}</span>
                      </>
                    )}
                  </>
                }
                help={
                  product.is_internal_code
                    ? 'Quita el vínculo con el catálogo TCGplayer. Los datos del producto no cambian.'
                    : 'El producto se queda con un código interno HCH- y pierde el vínculo con el catálogo. Si después escaneas este código, se tomará como nuevo y podrás asignarlo al producto correcto del catálogo.'
                }
                action={product.is_internal_code ? 'Desvincular del catálogo' : 'Desvincular código'}
                disabled={product.is_internal_code && product.catalog_product_id == null}
                reasonPlaceholder="Ej. Se escaneó el código de otro producto / el catálogo lo vinculó mal"
                confirm="Desvincular"
                danger
                run={async (_value, reason) => {
                  const p = await unlinkProduct(product.id, reason)
                  applied(
                    p,
                    p.barcode === product.barcode
                      ? 'Producto desvinculado del catálogo.'
                      : `Código ${product.barcode} desvinculado. El producto ahora es ${p.barcode} (imprime su etiqueta nueva).`,
                  )
                }}
              />
            </>
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

/**
 * Corrección que se aplica al momento y pide motivo (queda en el historial).
 * Con valueLabel pide además un valor (p. ej. la cantidad correcta).
 */
function CorrectionSection({
  title,
  summary,
  help,
  action,
  valueLabel,
  placeholder,
  reasonPlaceholder,
  confirm,
  danger,
  disabled,
  run,
}: {
  title: string
  summary: ReactNode
  help?: string
  action: string
  valueLabel?: string
  placeholder?: string
  reasonPlaceholder: string
  confirm: string
  danger?: boolean
  disabled?: boolean
  run: (value: string, reason: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function apply() {
    if (busy) return
    setError(null)
    if (valueLabel && !value.trim()) return setError(`Escribe la ${valueLabel.toLowerCase()}.`)
    if (!reason.trim()) return setError('El motivo es obligatorio.')
    setBusy(true)
    try {
      await run(value, reason)
      setOpen(false)
      setValue('')
      setReason('')
    } catch (e) {
      setError(isNetworkError(e) ? 'Sin conexión: intenta cuando vuelva el internet.' : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-md border border-line p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto min-w-0">
          <p className="text-label">{title}</p>
          <p className="text-ink-muted">{summary}</p>
        </div>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} disabled={disabled} className="btn btn-secondary btn-sm">
            {action}
          </button>
        )}
      </div>
      {open && (
        // No es un <form> (ya estamos dentro de uno): Enter aplica la corrección.
        <div
          className="mt-3 space-y-3"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void apply()
            }
          }}
        >
          {help && <p className="text-caption text-ink-muted">{help}</p>}
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            {valueLabel && (
              <div>
                <label className="field-label" htmlFor={`cs-${title}-value`}>{valueLabel} *</label>
                <input
                  id={`cs-${title}-value`}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  inputMode="numeric"
                  placeholder={placeholder}
                  autoFocus
                  autoComplete="off"
                  className="field h-10 tabular-nums"
                />
              </div>
            )}
            <div className={valueLabel ? '' : 'sm:col-span-2'}>
              <label className="field-label" htmlFor={`cs-${title}-reason`}>Motivo *</label>
              <input
                id={`cs-${title}-reason`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={reasonPlaceholder}
                autoFocus={!valueLabel}
                autoComplete="off"
                className="field h-10"
              />
            </div>
          </div>
          {error && (
            <p className="notice bg-danger-bg text-danger-fg">
              <Icon name="alert" className="mt-0.5" />
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setError(null)
              }}
              className="btn btn-ghost btn-sm"
            >
              Cancelar
            </button>
            <button type="button" onClick={() => void apply()} disabled={busy} className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`}>
              {busy ? 'Aplicando…' : confirm}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
