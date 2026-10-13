import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { catalogThumb, getCatalogStatus, searchCatalog, type CatalogStatus } from '../lib/catalog'
import { formatInt } from '../lib/format'
import type { CatalogItem } from '../lib/types'

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
        <label htmlFor="pf-catalog" className="mb-1 block text-base font-bold text-slate-700">
          Buscar en el catálogo TCG
        </label>
        {status && status.products > 0 && (
          <span className="text-sm text-slate-500">
            {formatInt(status.products)} productos
            {status.imported_at && ` · actualizado ${new Date(status.imported_at).toLocaleDateString('es-MX')}`}
          </span>
        )}
      </div>
      {empty ? (
        <p className="rounded-lg bg-amber-100 px-3 py-2 font-semibold text-amber-900">
          El catálogo está vacío. Hay que correr la importación (ver README → Catálogo TCG).
        </p>
      ) : (
        <input
          id="pf-catalog"
          name="catalog"
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          placeholder='Ej. "delta reign etb", "caja 151", "micas negras mate dragon"'
          className="w-full rounded-lg border-2 border-blue-500 bg-white px-3 py-2 text-xl focus:border-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200"
        />
      )}
      {loading && <p className="mt-2 text-slate-500">Buscando…</p>}
      {error && <p className="mt-2 font-semibold text-red-700">No se pudo buscar: {error}</p>}
      {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
        <p className="mt-2 text-slate-600">Sin resultados. Prueba con otras palabras (en inglés, como en TCGplayer).</p>
      )}
      {results.length > 0 && (
        <ul ref={listRef} className="mt-2 max-h-72 overflow-auto rounded-lg border-2 border-slate-300" role="listbox">
          {results.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r)}
                className={`flex w-full items-center gap-3 p-2 text-left ${i === active ? 'bg-blue-100' : 'bg-white hover:bg-slate-50'}`}
              >
                {r.image_url ? (
                  <img src={catalogThumb(r.image_url) ?? ''} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded bg-white object-contain" />
                ) : (
                  <div className="h-14 w-14 shrink-0 rounded bg-slate-200" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-bold">{r.name}</p>
                  <p className="truncate text-sm text-slate-600">
                    {r.game} · {r.set_name}
                    {r.released_on && ` · ${r.released_on.slice(0, 4)}`}
                    {r.market_price != null && ` · ref. ${usd.format(r.market_price)}`}
                  </p>
                  {r.upc_match && <p className="text-sm font-bold text-emerald-700">✓ El código de barras coincide</p>}
                  {r.linked_barcode && (
                    <p className="truncate text-sm font-bold text-amber-700">
                      Ya está en inventario con el código {r.linked_barcode}
                    </p>
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
