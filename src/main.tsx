import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { inventoryStore } from './store/inventoryStore'
import './index.css'

inventoryStore.start()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
