import { useCategories } from '../lib/categories'

interface Props {
  id?: string
  value: string
  onChange: (value: string) => void
  className?: string
}

/** Categoría del producto: las del negocio (Configuración → Categorías), con sus subcategorías. */
export function CategorySelect({ id, value, onChange, className = 'field h-10 cursor-pointer' }: Props) {
  const { tree, values } = useCategories()
  // Productos viejos pueden traer una categoría que ya no existe: se conserva hasta que se cambie.
  const legacy = value && !values.has(value) ? value : null
  return (
    <select id={id} name="category" value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">Sin categoría</option>
      {tree.map((c) =>
        c.children.length ? (
          <optgroup key={c.id} label={c.name}>
            {c.children.map((s) => (
              <option key={s.id} value={s.value}>
                {s.name}
              </option>
            ))}
            <option value={c.value}>{c.name} (otros)</option>
          </optgroup>
        ) : (
          <option key={c.id} value={c.value}>
            {c.name}
          </option>
        ),
      )}
      {legacy && <option value={legacy}>{legacy} (anterior)</option>}
    </select>
  )
}
