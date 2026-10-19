import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate, type Location } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { Icon } from '../components/Icon'
import { appTitle, useSettings } from '../lib/settings'
import { supabaseConfigured } from '../lib/supabase'

const LAST_EMAIL_KEY = 'hachiko.lastEmail'

export function LoginPage() {
  const { session, loading, signIn } = useAuth()
  const settings = useSettings()
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

  return (
    <div className="grid min-h-full place-items-center bg-app p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm p-8">
        <span className="mb-5 grid size-10 place-items-center rounded-md bg-brand text-on-brand">
          <Icon name="box" size={20} />
        </span>
        <h1 className="text-title-lg">{appTitle(settings)}</h1>
        <p className="mt-1 mb-6 text-ink-muted">Inicia sesión para continuar.</p>

        {!supabaseConfigured && (
          <p className="notice mb-4 bg-danger-bg text-danger-fg">
            <Icon name="alert" className="mt-0.5" />
            Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (ver README).
          </p>
        )}

        <label htmlFor="email" className="field-label">Correo</label>
        <input
          id="email"
          ref={emailRef}
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="field h-10"
        />

        <label htmlFor="password" className="field-label mt-4">Contraseña</label>
        <input
          id="password"
          ref={passwordRef}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="field h-10"
        />

        {error && (
          <p role="alert" className="notice mt-4 bg-danger-bg text-danger-fg">
            <Icon name="alert" className="mt-0.5" />
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting} className="btn btn-primary mt-6 h-10 w-full">
          {submitting ? 'Entrando…' : 'Iniciar sesión'}
        </button>
        <p className="mt-4 text-caption text-ink-subtle">
          ¿No tienes cuenta? Pide a un administrador que te cree un usuario.
        </p>
      </form>
    </div>
  )
}
