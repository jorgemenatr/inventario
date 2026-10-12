import { useEffect, type RefObject } from 'react'

/**
 * Mantiene el foco en el input de escaneo: lo recupera tras cada clic, al
 * volver a la ventana o cuando el foco se va a "ningún lado".
 * Los campos marcados con data-keep-focus (p. ej. "Cantidad por escaneo")
 * pueden conservar el foco mientras se editan.
 */
export function useKeepFocus(ref: RefObject<HTMLInputElement | null>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const refocus = () => {
      setTimeout(() => {
        const active = document.activeElement as HTMLElement | null
        if (!ref.current || active === ref.current) return
        if (active?.closest('[data-keep-focus]')) return
        if (active?.closest('[role="dialog"]')) return
        ref.current.focus({ preventScroll: true })
      }, 0)
    }
    ref.current?.focus({ preventScroll: true })
    document.addEventListener('pointerup', refocus)
    document.addEventListener('focusout', refocus)
    window.addEventListener('focus', refocus)
    return () => {
      document.removeEventListener('pointerup', refocus)
      document.removeEventListener('focusout', refocus)
      window.removeEventListener('focus', refocus)
    }
  }, [ref, enabled])
}
