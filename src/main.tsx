import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initSimulatorFlag } from './components/ScannerSimulator'
import { inventoryStore } from './store/inventoryStore'
import './index.css'

initSimulatorFlag()
inventoryStore.start()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
