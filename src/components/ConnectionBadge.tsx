import { inventoryStore } from '../store/inventoryStore'
import { useInventory } from '../store/useInventory'

export function ConnectionBadge() {
  const { online, queue, syncing, syncError, failed } = useInventory()
  const pending = queue.length

  let cls = 'bg-emerald-600 text-white'
  let text = 'En línea'
  if (!online) {
    cls = 'bg-red-600 text-white animate-pulse'
    text = `Sin conexión: ${pending} pendiente${pending === 1 ? '' : 's'}`
  } else if (syncing) {
    cls = 'bg-amber-400 text-slate-900'
    text = `Sincronizando… ${pending} pendiente${pending === 1 ? '' : 's'}`
  } else if (pending > 0) {
    cls = 'bg-amber-400 text-slate-900'
    text = `${pending} pendiente${pending === 1 ? '' : 's'} por sincronizar`
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void inventoryStore.checkConnection()}
        title="Reintentar sincronización"
        className={`rounded-full px-4 py-2 text-base font-bold ${cls}`}
      >
        {text}
      </button>
      {syncError && <span className="max-w-xs text-sm font-semibold text-red-300">{syncError}</span>}
      {failed.length > 0 && (
        <span className="rounded-full bg-red-700 px-3 py-1 text-sm font-bold text-white">
          {failed.length} con error (ver Historial)
        </span>
      )}
    </div>
  )
}
