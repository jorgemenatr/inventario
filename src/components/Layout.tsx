import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { inventoryStore } from '../store/inventoryStore'
import { useInventory } from '../store/useInventory'
import { ConnectionBadge } from './ConnectionBadge'
import { Icon, type IconName } from './Icon'
import { ScannerSimulator, useSimulatorEnabled } from './ScannerSimulator'

interface NavItem {
  to: string
  label: string
  icon: IconName
  end?: boolean
  /** Subsecciones: se muestran solo mientras se está dentro de la sección. */
  children?: NavItem[]
}

const NAV: NavItem[] = [
  { to: '/mostrador', label: 'Mostrador', icon: 'store' },
  { to: '/ventas', label: 'Ventas', icon: 'receipt' },
  { to: '/clientes', label: 'Clientes', icon: 'users' },
  {
    to: '/inventario',
    label: 'Inventario',
    icon: 'grid',
    children: [
      // Escaneo: alta y conteo de productos con el lector.
      { to: '/agregar', label: 'Agregar', icon: 'barcode' },
      { to: '/historial', label: 'Historial', icon: 'history' },
    ],
  },
]

/** ¿La ruta actual es la sección o alguna de sus subsecciones? */
function inSection(item: NavItem, pathname: string) {
  const match = (n: NavItem) => (n.end ? pathname === n.to : pathname === n.to || pathname.startsWith(`${n.to}/`))
  return match(item) || (item.children ?? []).some(match)
}

const ROLE_LABELS: Record<string, string> = { admin: 'Administrador', staff: 'Personal' }

export function Layout() {
  const { pathname } = useLocation()
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

        <div className="flex flex-wrap gap-0.5 md:flex-col md:flex-nowrap">
          {NAV.map((n) => {
            const open = !!n.children && inSection(n, pathname)
            return (
              <div key={n.to} className="contents md:block">
                <NavLink to={n.to} end={n.end} className={navItem}>
                  <Icon name={n.icon} size={20} />
                  <span>{n.label}</span>
                  {n.children && (
                    <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} className="ml-auto hidden text-nav-ink-subtle md:block" />
                  )}
                </NavLink>
                {open && (
                  <div className="contents md:mt-0.5 md:ml-4 md:flex md:flex-col md:gap-0.5 md:border-l md:border-nav-border md:pl-2">
                    {n.children!.map((c) => (
                      <NavLink key={c.to} to={c.to} end={c.end} className={navItem}>
                        <Icon name={c.icon} size={18} />
                        <span>{c.label}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3 md:mt-auto md:ml-0 md:flex-col md:flex-nowrap md:items-stretch">
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
