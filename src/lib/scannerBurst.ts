/**
 * Detecta cuando el lector "teclea" un código dentro de un campo que no es el
 * de escaneo (p. ej. el formulario de producto nuevo). Un lector escribe cada
 * carácter con pocos milisegundos de diferencia; una persona, no.
 */
const MAX_GAP_MS = 35
const MIN_LENGTH = 4

export function createBurstDetector() {
  let last = 0
  let buffer = ''
  return {
    /** Llamar en onKeyDown. Al recibir Enter devuelve el código leído, si lo hubo. */
    handle(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): string | null {
      const now = performance.now()
      if (e.key === 'Enter') {
        const scanned = buffer.length >= MIN_LENGTH && now - last < 100 ? buffer : null
        buffer = ''
        return scanned
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (now - last > MAX_GAP_MS) buffer = ''
        buffer += e.key
        last = now
      } else if (e.key !== 'Shift') {
        buffer = ''
      }
      return null
    },
  }
}
