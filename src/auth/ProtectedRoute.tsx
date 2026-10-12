import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { UserRole } from '../lib/types'
import { useAuth } from './useAuth'

interface Props {
  children: ReactNode
  /** Para fases futuras (POS): restringir por rol. Sin valor = cualquier usuario. */
  roles?: UserRole[]
}

export function ProtectedRoute({ children, roles }: Props) {
  const { session, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <div className="grid h-full place-items-center text-2xl text-slate-500">Cargando…</div>
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  if (roles && profile && !roles.includes(profile.role)) {
    return <div className="grid h-full place-items-center text-2xl">No tienes permiso para ver esta página.</div>
  }
  return <>{children}</>
}
