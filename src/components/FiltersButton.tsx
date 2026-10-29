import { Icon } from './Icon'

/**
 * En el celular los filtros van plegados: este botón los muestra u oculta.
 * El panel de filtros usa `open ? '' : 'max-md:hidden'`. En md+ no se ve.
 */
export function FiltersButton({
  open,
  active,
  onToggle,
  className,
}: {
  open: boolean
  active: boolean
  onToggle: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`btn btn-secondary self-start md:hidden ${className ?? ''}`}
    >
      <Icon name="filter" />
      Filtros
      {active && <span className="size-2 rounded-pill bg-brand" aria-label="(hay filtros activos)" />}
    </button>
  )
}
