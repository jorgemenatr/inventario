import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { Profile } from '../lib/types'

export interface AuthContextValue {
  session: Session | null
  user: User | null
  /** Perfil (rol incluido). Listo para restringir funciones en el POS. */
  profile: Profile | null
  loading: boolean
  /** Devuelve null si todo salió bien, o un mensaje de error en español. */
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
