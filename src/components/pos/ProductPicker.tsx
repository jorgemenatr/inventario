import { useMemo, useState, type KeyboardEvent, type RefObject } from 'react'
import { normalizeBarcode } from '../../lib/barcode'
import { formatInt, formatMoney } from '../../lib/format'
import type { CachedProduct } from '../../store/inventoryStore'
import { Icon } from '../Icon'
import { ProductImage } from '../ProductImage'

interface Props {
  inputRef: RefObject<HTMLInputElement | null>
  products: Record<string, CachedProduct>
  /** Piezas que todavía se pueden agregar (stock − apartado en tickets abiertos). */
  available: (p: CachedProduct) => number
  onPick: (p: CachedProduct) => void
  disabled?: boolean
}

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const MAX_RESULTS = 8

/**
 * Agregar productos al ticket: con el lector (código + Enter) o escribiendo
 * parte del nombre y eligiendo de la lista (flechas + Enter, o clic).
 */
export function ProductPicker({ inputRef, products, available, onPick, disabled }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const results = useMemo(() => {
    const words = normalize(query.trim()).split(/\s+/).filter(Boolean)
    if (!words.length) return []
    const out: CachedProduct[] = []
    for (const p of Object.values(products)) {
      const text = normalize(`${p.name} ${p.barcode} ${p.category ?? ''}`)
      if (words.every((w) => text.includes(w))) out.push(p)
    }
    // Primero lo que sí se puede vender; luego por nombre.
    return out
      .sort((a, b) => Number(available(b) > 0) - Number(available(a) > 0) || a.name.localeCompare(b.name, 'es-MX'))
      .slice(0, MAX_RESULTS)
  }, [query, products, available])

  function pick(p: CachedProduct) {
    onPick(p)
    setQuery('')
    setActive(0)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (results.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length)
      return
    }
    if (e.key === 'Escape') {
      setQuery('')
      return
    }
    if (e.key !== 'Enter') return
    e.preventDefault()
    // Código exacto (lector): se agrega directo.
    const code = normalizeBarcode(query)
    const exact = products[code]
    if (exact) return pick(exact)
    if (results[active]) return pick(results[active])
  }

  return (
    <div className="relative">
      <label htmlFor="pos-product" className="field-label">
        Agregar producto: escanea el código o busca por nombre
      </label>
      <div className="relative">
        <Icon name="barcode" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-subtle" />
        <input
          id="pos-product"
          ref={inputRef}
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Código de barras o nombre…"
          className="field h-12 pl-9 text-heading"
        />
      </div>
      {results.length > 0 && (
        <ul
          className="absolute z-20 mt-1 max-h-96 w-full divide-y divide-line overflow-auto rounded-md border border-line bg-surface shadow-popover"
          role="listbox"
        >
          {results.map((p, i) => {
            const avail = available(p)
            return (
              <li key={p.barcode} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(p)}
                  className={`flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left ${i === active ? 'bg-brand-soft' : 'hover:bg-subtle'}`}
                >
                  <ProductImage path={p.image_url} alt="" className="size-10 shrink-0 rounded-xs" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-label text-ink">{p.name}</p>
                    <p className="truncate font-mono text-caption text-ink-subtle">{p.barcode}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-label tabular-nums">{formatMoney(p.price)}</p>
                    {avail > 0 ? (
                      <p className="text-caption text-ink-muted">Disponibles: {formatInt(avail)}</p>
                    ) : (
                      <p className="text-caption text-danger-fg">{p.quantity > 0 ? 'Apartado en tickets' : 'Sin stock'}</p>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
