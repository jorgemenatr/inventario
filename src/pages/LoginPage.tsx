import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate, type Location } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { supabaseConfigured } from '../lib/supabase'

const LAST_EMAIL_KEY = 'hachiko.lastEmail'

export function LoginPage() {
  const { session, loading, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: Location } | null)?.from
  const target = from ? `${from.pathname}${from.search}${from.hash}` : '/'

  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(LAST_EMAIL_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  // Foco: si ya recordamos el correo, directo a la contraseña.
  useEffect(() => {
    if (loading || session) return
    ;(email ? passwordRef : emailRef).current?.focus()
  }, [loading, session])

  if (!loading && session) return <Navigate to={target} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    setError(null)
    if (!email.trim() || !password) {
      setError('Escribe tu correo y contraseña.')
      ;(email.trim() ? passwordRef : emailRef).current?.focus()
      return
    }
    setSubmitting(true)
    const err = await signIn(email, password)
    setSubmitting(false)
    if (err) {
      setError(err)
      setPassword('')
      passwordRef.current?.focus()
      return
    }
    try {
      localStorage.setItem(LAST_EMAIL_KEY, email.trim())
    } catch {
      /* no crítico */
    }
    navigate(target, { replace: true })
  }

  const input =
    'w-full rounded-xl border-4 border-slate-400 px-4 py-3 text-2xl focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-200'

  return (
    <div className="grid min-h-full place-items-center bg-slate-900 p-4">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <h1 className="text-3xl font-black">Inventario Hachiko</h1>
        <p className="mb-6 mt-1 text-lg text-slate-600">Inicia sesión para continuar</p>

        {!supabaseConfigured && (
          <p className="mb-4 rounded-lg bg-red-100 p-3 font-semibold text-red-800">
            Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (ver README).
          </p>
        )}

        <label htmlFor="email" className="mb-1 block text-lg font-bold">Correo</label>
        <input
          id="email"
          ref={emailRef}
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={input}
        />

        <label htmlFor="password" className="mb-1 mt-4 block text-lg font-bold">Contraseña</label>
        <input
          id="password"
          ref={passwordRef}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={input}
        />

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-100 p-3 text-lg font-bold text-red-800">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded-xl bg-blue-700 py-4 text-2xl font-black text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {submitting ? 'Entrando…' : 'Iniciar sesión'}
        </button>
        <p className="mt-4 text-sm text-slate-500">
          ¿No tienes cuenta? Pide a un administrador que te cree un usuario.
        </p>
      </form>
    </div>
  )
}
