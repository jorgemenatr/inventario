import { getSettings } from './settings'

/**
 * Limpia lo que "teclea" el lector.
 *
 * Caso especial: muchos lectores emulan un teclado US. En una laptop con
 * distribución Español (Latinoamérica) la tecla `-` de US produce `'`, así que
 * la etiqueta `HCH-000001` llega como `HCH'000001` (o con otro símbolo).
 * Aquí la devolvemos a su forma correcta. El prefijo (HCH) es el del negocio.
 */
export function normalizeBarcode(raw: string): string {
  const s = raw.trim().replace(/\s+/g, '')
  const prefix = getSettings().codePrefix
  const internal = s.match(new RegExp(`^${prefix}[^0-9a-z]?(\\d{6})$`, 'i'))
  if (internal) return `${prefix}-${internal[1]}`
  return s
}

export function isInternalCode(code: string) {
  return new RegExp(`^${getSettings().codePrefix}-\\d{6}$`).test(code)
}

/** "HCH-" (para textos de ayuda). */
export const internalCodeLabel = () => `${getSettings().codePrefix}-`
