import { inventoryStore } from '../store/inventoryStore'
import { useInventory } from '../store/useInventory'
import { Icon } from './Icon'

/** Estado de conexión y cola, dentro de la barra lateral oscura. */
export function ConnectionBadge() {
  const { online, queue, syncing, syncError, failed } = useInventory()
  const pending = queue.length
  const plural = pending === 1 ? '' : 's'

  let tone = 'badge-success'
  let text = 'En línea'
  if (!online) {
    tone = 'badge-danger'
    text = `Sin conexión: ${pending} pendiente${plural}`
  } else if (syncing) {
    tone = 'badge-warning'
    text = `Sincronizando… ${pending} pendiente${plural}`
  } else if (pending > 0) {
    tone = 'badge-warning'
    text = `${pending} pendiente${plural} por sincronizar`
  }

  return (
    <div className="flex flex-wrap items-center gap-2 md:flex-col md:items-stretch">
      <button
        type="button"
        onClick={() => void inventoryStore.checkConnection()}
        title="Reintentar sincronización"
        className={`badge ${tone} cursor-pointer justify-start whitespace-normal py-1.5 text-left focus-visible:outline-nav-focus`}
      >
        <span className="flex-1">{text}</span>
        <Icon name={online ? 'refresh' : 'wifi-off'} size={14} />
      </button>
      {syncError && <p className="max-w-xs px-2 text-caption text-nav-ink-muted">{syncError}</p>}
      {failed.length > 0 && (
        <span className="badge badge-danger whitespace-normal">
          {failed.length} con error (ver Historial)
        </span>
      )}
    </div>
  )
}
