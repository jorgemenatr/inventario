/**
 * Limpia lo que "teclea" el lector.
 *
 * Caso especial: muchos lectores emulan un teclado US. En una laptop con
 * distribución Español (Latinoamérica) la tecla `-` de US produce `'`, así que
 * la etiqueta `HCH-000001` llega como `HCH'000001` (o con otro símbolo).
 * Aquí la devolvemos a su forma correcta.
 */
export function normalizeBarcode(raw: string): string {
  const s = raw.trim().replace(/\s+/g, '')
  const internal = s.match(/^hch[^0-9a-z]?(\d{6})$/i)
  if (internal) return `HCH-${internal[1]}`
  return s
}

export function isInternalCode(code: string) {
  return /^HCH-\d{6}$/.test(code)
}
