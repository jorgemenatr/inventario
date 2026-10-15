import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Profile, UserRole } from './types'

const COLUMNS = 'id, email, full_name, role, created_at'

export async function listUsers(): Promise<Profile[]> {
  const { data, error } = await supabase.from('profiles').select(COLUMNS).order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Profile[]
}

export async function updateUser(id: string, patch: { full_name: string; role: UserRole }): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .update({ full_name: patch.full_name.trim() || null, role: patch.role })
    .eq('id', id)
    .select(COLUMNS)
    .single()
  if (error) throw error
  return data as Profile
}

export interface NewUser {
  full_name: string
  email: string
  role: UserRole
  /** Contraseña temporal: se la das a la persona para su primer inicio de sesión. */
  password: string
}

/** Crea el usuario con la Edge Function `crear-usuario` (solo admin). */
export async function createUser(input: NewUser): Promise<Profile> {
  const { data, error } = await supabase.functions.invoke('crear-usuario', {
    body: { ...input, full_name: input.full_name.trim(), email: input.email.trim().toLowerCase() },
  })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      if (body?.error) throw new Error(body.error)
      if (res.status === 404) throw new Error('Falta publicar la Edge Function "crear-usuario" en Supabase (ver README).')
      throw new Error(`No se pudo crear el usuario (error ${res.status})`)
    }
    throw error
  }
  return (data as { profile: Profile }).profile
}
