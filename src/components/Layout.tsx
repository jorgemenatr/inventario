import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { inventoryStore } from '../store/inventoryStore'
import { useInventory } from '../store/useInventory'
import { ConnectionBadge } from './ConnectionBadge'
import { ScannerSimulator, useSimulatorEnabled } from './ScannerSimulator'

export function Layout() {
  const { user, profile, signOut } = useAuth()
  const { queue } = useInventory()
  const navigate = useNavigate()
  const simulator = useSimulatorEnabled()

  async function handleSignOut() {
    if (queue.length > 0) {
      const ok = window.confirm(
        `Hay ${queue.length} operación(es) sin sincronizar.\n\n` +
          'Se quedarán guardadas en esta computadora y se enviarán cuando se vuelva a iniciar sesión con internet.\n\n' +
          '¿Cerrar sesión de todos modos?',
      )
      if (!ok) return
    }
    await signOut()
    inventoryStore.clearSessionData()
    navigate('/login', { replace: true })
  }

  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-4 py-2 text-lg font-bold ${isActive ? 'bg-white text-slate-900' : 'text-white hover:bg-slate-700'}`

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-4 bg-slate-900 px-5 py-3 text-white print:hidden">
        <span className="text-2xl font-black tracking-tight">Inventario Hachiko</span>
        <nav className="flex gap-2">
          <NavLink to="/" end className={link}>
            Escaneo
          </NavLink>
          <NavLink to="/historial" className={link}>
            Historial
          </NavLink>
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-4">
          <ConnectionBadge />
          <span className="text-base text-slate-300" title={profile?.role ? `Rol: ${profile.role}` : undefined}>
            {user?.email}
          </span>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="rounded-lg border-2 border-white px-4 py-2 text-lg font-bold hover:bg-white hover:text-slate-900"
          >
            Cerrar sesión
          </button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </main>
      {simulator && <ScannerSimulator />}
    </div>
  )
}
