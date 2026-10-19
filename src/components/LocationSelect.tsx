import { LOCATION_LABELS, type StockLocation } from '../lib/types'
import { Segmented } from './Segmented'

/** Tienda | Bodega (Tienda va primero: es la ubicación por defecto). */
export function LocationSelect({
  value,
  onChange,
  label = 'Ubicación',
  size,
  disabled,
}: {
  value: StockLocation
  onChange: (value: StockLocation) => void
  label?: string
  size?: 'md' | 'lg'
  disabled?: boolean
}) {
  return (
    <Segmented
      value={value}
      onChange={onChange}
      label={label}
      size={size}
      disabled={disabled}
      options={[
        { value: 'store', label: LOCATION_LABELS.store, icon: 'store' },
        { value: 'warehouse', label: LOCATION_LABELS.warehouse, icon: 'box' },
      ]}
    />
  )
}
