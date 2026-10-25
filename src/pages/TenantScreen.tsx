import { Icon } from '../components/Icon'
import { baseDomain, type TenantResolution } from '../lib/tenant'

/** Lo que se muestra cuando este sitio no corresponde a un cliente activo. */
export function TenantScreen({ resolution }: { resolution: Exclude<TenantResolution, { kind: 'tenant' }> | { kind: 'suspended'; name: string } }) {
  let title: string
  let body: string
  switch (resolution.kind) {
    case 'landing':
      title = 'Kanan POS'
      body = 'Punto de venta e inventario para tiendas. Si ya eres cliente, entra con la dirección de tu negocio.'
      break
    case 'unknown':
      title = 'Este negocio no existe'
      body = `No hay ningún negocio en ${resolution.slug}.${baseDomain}. Revisa la dirección.`
      break
    case 'suspended':
      title = `${resolution.name}: cuenta suspendida`
      body = 'El acceso a esta cuenta está suspendido. Comunícate con Kanan POS para reactivarla.'
      break
    default:
      title = 'Falta configuración'
      body = 'Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (ver README).'
  }
  return (
    <div className="grid min-h-full place-items-center bg-app p-4">
      <div className="card w-full max-w-sm p-8">
        <span className="mb-5 grid size-10 place-items-center rounded-md bg-brand text-on-brand">
          <Icon name={resolution.kind === 'landing' ? 'box' : 'alert'} size={20} />
        </span>
        <h1 className="text-title-lg">{title}</h1>
        <p className="mt-2 text-ink-muted">{body}</p>
      </div>
    </div>
  )
}
