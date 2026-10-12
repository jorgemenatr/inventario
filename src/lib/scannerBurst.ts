/**
 * Detecta cuando el lector "teclea" un código dentro de un campo que no es el
 * de escaneo (p. ej. el formulario de producto nuevo). Un lector escribe cada
 * carácter con pocos milisegundos de diferencia; una persona, no.
 */
const MAX_GAP_MS = 40
const MIN_LENGTH = 4
const MAX_ENTER_GAP_MS = 80

export function createBurstDetector() {
  let last = 0
  let buffer = ''
  return {
    /** Llamar en onKeyDown. Al recibir Enter devuelve el código leído, si lo hubo. */
    handle(e: { key: string; timeStamp: number; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): string | null {
      // timeStamp = cuándo se generó la tecla (no cuándo se procesó), para que
      // los re-renders entre teclas no alteren la medición.
      const now = e.timeStamp || performance.now()
      if (e.key === 'Enter') {
        const scanned = buffer.length >= MIN_LENGTH && now - last < MAX_ENTER_GAP_MS ? buffer : null
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
