import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { Layout } from './components/Layout'
import { CustomerDetailPage } from './pages/CustomerDetailPage'
import { CustomersPage } from './pages/CustomersPage'
import { HistoryPage } from './pages/HistoryPage'
import { InventoryPage } from './pages/InventoryPage'
import { MostradorPage } from './pages/MostradorPage'
import { VentasPage } from './pages/VentasPage'
import { LabelPage } from './pages/LabelPage'
import { LoginPage } from './pages/LoginPage'
import { ScanPage } from './pages/ScanPage'

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/etiqueta/:code"
            element={
              <ProtectedRoute>
                <LabelPage />
              </ProtectedRoute>
            }
          />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            {/* La app abre en el Mostrador. */}
            <Route index element={<Navigate to="/mostrador" replace />} />
            <Route path="agregar" element={<ScanPage />} />
            <Route path="inventario" element={<InventoryPage />} />
            <Route path="mostrador" element={<MostradorPage />} />
            <Route path="ventas" element={<VentasPage />} />
            <Route path="clientes" element={<CustomersPage />} />
            <Route path="clientes/:id" element={<CustomerDetailPage />} />
            <Route path="historial" element={<HistoryPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
