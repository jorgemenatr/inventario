import { CATEGORY_VALUES, MAIN_CATEGORIES, TCG, TCG_GAMES, categoryLabel, tcgCategory } from '../lib/categories'

interface Props {
  id?: string
  value: string
  onChange: (value: string) => void
  className?: string
}

/** Categoría del producto: TCG (con sus juegos) y las demás categorías fijas. */
export function CategorySelect({ id, value, onChange, className = 'field h-10 cursor-pointer' }: Props) {
  // Productos viejos pueden traer una categoría libre: se conserva hasta que se cambie.
  const legacy = value && !CATEGORY_VALUES.includes(value) ? value : null
  return (
    <select id={id} name="category" value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">Sin categoría</option>
      <optgroup label="TCG">
        {TCG_GAMES.map((g) => (
          <option key={g} value={tcgCategory(g)}>
            {g}
          </option>
        ))}
        <option value={TCG}>{categoryLabel(TCG)}</option>
      </optgroup>
      {MAIN_CATEGORIES.filter((c) => c !== TCG).map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
      {legacy && <option value={legacy}>{legacy} (anterior)</option>}
    </select>
  )
}
