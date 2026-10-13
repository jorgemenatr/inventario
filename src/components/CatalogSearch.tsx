import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { catalogThumb, getCatalogStatus, searchCatalog, type CatalogStatus } from '../lib/catalog'
import { formatInt } from '../lib/format'
import type { CatalogItem } from '../lib/types'
import { Icon } from './Icon'

interface Props {
  inputRef: RefObject<HTMLInputElement | null>
  onSelect: (item: CatalogItem) => void
}

const usd = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'USD' })
const DEBOUNCE_MS = 300

/** Buscador del catálogo TCG dentro del alta de producto. Flechas para moverse, Enter para elegir. */
export function CatalogSearch({ inputRef, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CatalogItem[]>([])
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<CatalogStatus | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    void getCatalogStatus().then(setStatus)
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    let current = true
    setLoading(true)
    const t = window.setTimeout(() => {
      searchCatalog(q)
        .then((r) => {
          if (!current) return
          setResults(r)
          setActive(0)
          setError(null)
        })
        .catch((e: unknown) => current && setError((e as Error).message ?? 'Error al buscar'))
        .finally(() => current && setLoading(false))
    }, DEBOUNCE_MS)
    return () => {
      current = false
      window.clearTimeout(t)
    }
  }, [query])

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function choose(item: CatalogItem) {
    onSelect(item)
    setQuery('')
    setResults([])
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!results.length) return
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length)
    } else if (e.key === 'Enter') {
      // Enter aquí elige el resultado; no guarda el formulario.
      e.preventDefault()
      if (results[active]) choose(results[active])
    }
  }

  const empty = status !== null && status.products === 0

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor="pf-catalog" className="field-label">
          Buscar en el catálogo TCG
        </label>
        {status && status.products > 0 && (
          <span className="text-caption text-ink-subtle">
            {formatInt(status.products)} productos
            {status.imported_at && ` · actualizado ${new Date(status.imported_at).toLocaleDateString('es-MX')}`}
          </span>
        )}
      </div>
      {empty ? (
        <p className="notice bg-warning-bg text-warning-fg">
          <Icon name="alert" className="mt-0.5" />
          El catálogo está vacío. Hay que correr la importación (ver README → Catálogo TCG).
        </p>
      ) : (
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-subtle" />
          <input
            id="pf-catalog"
            name="catalog"
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            placeholder='Ej. "delta reign etb", "caja 151", "micas negras mate dragon"'
            className="field h-10 pl-9"
          />
        </div>
      )}
      {loading && <p className="mt-2 text-ink-muted">Buscando…</p>}
      {error && (
        <p className="mt-2 notice bg-danger-bg text-danger-fg">
          <Icon name="alert" className="mt-0.5" />
          No se pudo buscar: {error}
        </p>
      )}
      {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
        <p className="mt-2 text-ink-muted">Sin resultados. Prueba con otras palabras (en inglés, como en TCGplayer).</p>
      )}
      {results.length > 0 && (
        <ul ref={listRef} className="mt-2 max-h-72 divide-y divide-line overflow-auto rounded-md border border-line bg-surface" role="listbox">
          {results.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r)}
                className={`flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left ${i === active ? 'bg-brand-soft' : 'hover:bg-subtle'}`}
              >
                {r.image_url ? (
                  <img src={catalogThumb(r.image_url) ?? ''} alt="" loading="lazy" className="size-12 shrink-0 rounded-xs bg-white object-contain" />
                ) : (
                  <div className="grid size-12 shrink-0 place-items-center rounded-xs bg-subtle text-ink-subtle">
                    <Icon name="image" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-label text-ink">{r.name}</p>
                  <p className="truncate text-caption text-ink-muted">
                    {r.game} · {r.set_name}
                    {r.released_on && ` · ${r.released_on.slice(0, 4)}`}
                    {r.market_price != null && ` · ref. ${usd.format(r.market_price)}`}
                  </p>
                  {r.upc_match && <span className="badge badge-success mt-1">El código de barras coincide</span>}
                  {r.linked_barcode && (
                    <span className="badge badge-warning mt-1 max-w-full truncate">
                      Ya está en inventario con el código {r.linked_barcode}
                    </span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
