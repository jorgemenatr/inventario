import { useSyncExternalStore } from 'react'
import { inventoryStore } from './inventoryStore'

export function useInventory() {
  return useSyncExternalStore(inventoryStore.subscribe, inventoryStore.getSnapshot)
}
