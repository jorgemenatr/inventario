import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { inventoryStore } from '../store/inventoryStore'
import { useInventory } from '../store/useInventory'
import { ConnectionBadge } from './ConnectionBadge'
import { Icon, type IconName } from './Icon'
import { ScannerSimulator, useSimulatorEnabled } from './ScannerSimulator'

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Escaneo', icon: 'barcode', end: true },
  { to: '/mostrador', label: 'Mostrador', icon: 'store' },
  { to: '/ventas', label: 'Ventas', icon: 'receipt' },
  { to: '/clientes', label: 'Clientes', icon: 'users' },
  { to: '/historial', label: 'Historial', icon: 'history' },
]

const ROLE_LABELS: Record<string, string> = { admin: 'Administrador', staff: 'Personal' }

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

  const displayName = profile?.full_name || user?.email || ''
  const navItem = ({ isActive }: { isActive: boolean }) =>
    `flex h-control-md items-center gap-3 rounded-md px-2 text-body focus-visible:outline-nav-focus ${
      isActive ? 'bg-nav-active-bg font-medium text-nav-active-ink' : 'text-nav-ink hover:bg-nav-hover'
    }`

  return (
    <div className="flex h-full flex-col md:flex-row">
      <nav
        aria-label="Principal"
        className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-nav-border bg-nav-bg p-3 text-nav-ink md:w-sidebar md:flex-col md:flex-nowrap md:items-stretch md:gap-4 md:border-r md:p-4 print:hidden"
      >
        <div className="flex items-center gap-2 px-2 md:pt-1 md:pb-2">
          <span className="grid size-7 place-items-center rounded-md bg-nav-avatar-bg text-nav-active-ink">
            <Icon name="box" />
          </span>
          <span className="text-heading">Inventario Hachiko</span>
        </div>

        <div className="flex gap-0.5 md:flex-col">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={navItem}>
              <Icon name={n.icon} size={20} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3 md:mt-auto md:ml-0 md:flex-col md:items-stretch">
          <ConnectionBadge />
          <div className="flex items-center gap-3 border-nav-border px-2 md:border-t md:pt-3">
            <span
              className="grid size-8 shrink-0 place-items-center rounded-pill bg-nav-avatar-bg text-label text-nav-ink uppercase"
              aria-hidden
            >
              {displayName.charAt(0) || '?'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium" title={user?.email}>
                {displayName}
              </p>
              {profile?.role && <p className="text-caption text-nav-ink-muted">{ROLE_LABELS[profile.role] ?? profile.role}</p>}
            </div>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="grid size-control-md shrink-0 cursor-pointer place-items-center rounded-md text-nav-ink-muted hover:bg-nav-hover hover:text-nav-ink focus-visible:outline-nav-focus"
            >
              <Icon name="log-out" size={18} />
            </button>
          </div>
        </div>
      </nav>
      <main className="min-h-0 min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
      {simulator && <ScannerSimulator />}
    </div>
  )
}
