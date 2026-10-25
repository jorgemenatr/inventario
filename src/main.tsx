import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initSimulatorFlag } from './components/ScannerSimulator'
import { current } from './lib/tenant'
import { TenantScreen } from './pages/TenantScreen'
import { inventoryStore } from './store/inventoryStore'
import './index.css'

const root = createRoot(document.getElementById('root')!)

if (current.kind === 'tenant' && current.tenant.status === 'activo') {
  initSimulatorFlag()
  inventoryStore.start()
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
} else {
  // Sin cliente activo no se arranca nada que hable con Supabase.
  root.render(
    <StrictMode>
      <TenantScreen
        resolution={current.kind === 'tenant' ? { kind: 'suspended', name: current.tenant.name } : current}
      />
    </StrictMode>,
  )
}
