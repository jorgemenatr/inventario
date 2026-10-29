import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useInventory } from '../store/useInventory'
import { Icon } from './Icon'

/*
 * Simulador de lector de código de barras (para probar sin lector físico).
 * Se activa con ?simulador=1 en la URL y se apaga con ?simulador=0.
 *
 * Igual que un lector USB, "teclea" el código muy rápido en el campo que tenga
 * el foco y al final manda Enter. Así se prueban también los casos de escaneo
 * accidental en el campo de cantidad o dentro del formulario de producto nuevo.
 */

const FLAG = 'hachiko.simulador'

/** Se llama al arrancar la app (antes del login, que cambia la URL). */
export function initSimulatorFlag() {
  try {
    const param = new URLSearchParams(window.location.search).get('simulador')
    if (param === '1') localStorage.setItem(FLAG, '1')
    if (param === '0') localStorage.removeItem(FLAG)
  } catch {
    /* sin localStorage: simulador apagado */
  }
}

export function useSimulatorEnabled() {
  const [enabled] = useState(() => {
    try {
      return localStorage.getItem(FLAG) === '1'
    } catch {
      return false
    }
  })
  return enabled
}

/** EAN-13 válido (prefijo 750 = México) con dígito verificador. */
function randomEan13() {
  let digits = '750'
  for (let i = 0; i < 9; i++) digits += Math.floor(Math.random() * 10)
  const sum = [...digits].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0)
  return digits + ((10 - (sum % 10)) % 10)
}

const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

function key(target: HTMLElement, type: 'keydown' | 'keyup', k: string) {
  return target.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }))
}

/** Teclea `code` + Enter en el elemento, como lo haría un lector. */
function typeLikeScanner(target: HTMLElement, code: string) {
  target.focus()
  for (const ch of code) {
    const allowed = key(target, 'keydown', ch)
    if (allowed && target instanceof HTMLInputElement) {
      const start = target.selectionStart ?? target.value.length
      const end = target.selectionEnd ?? target.value.length
      valueSetter.call(target, target.value.slice(0, start) + ch + target.value.slice(end))
      target.setSelectionRange(start + 1, start + 1)
      target.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }))
    }
    key(target, 'keyup', ch)
  }
  key(target, 'keydown', 'Enter')
  key(target, 'keyup', 'Enter')
}

export function ScannerSimulator() {
  const { products } = useInventory()
  const panelRef = useRef<HTMLDivElement>(null)
  const lastTarget = useRef<HTMLElement | null>(null)
  const [open, setOpen] = useState(true)
  const [custom, setCustom] = useState('')
  const [newCode, setNewCode] = useState(randomEan13)

  // Recordamos el último campo enfocado fuera del simulador: ahí "escribe" el lector.
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement
      if (!panelRef.current?.contains(t)) lastTarget.current = t
    }
    document.addEventListener('focusin', onFocus)
    lastTarget.current = document.activeElement as HTMLElement
    return () => document.removeEventListener('focusin', onFocus)
  }, [])

  const known = useMemo(
    () =>
      Object.values(products)
        .filter((p) => !p.pending)
        .slice(-8)
        .reverse(),
    [products],
  )

  function scan(code: string) {
    const target =
      lastTarget.current && document.contains(lastTarget.current) ? lastTarget.current : document.body
    // Igual que un lector real: "escribe" donde esté el foco.
    setTimeout(() => typeLikeScanner(target, code), 0)
  }

  const btn = 'w-full cursor-pointer rounded-md border border-line bg-surface px-2.5 py-1.5 text-left hover:bg-subtle'
  // onMouseDown preventDefault: los botones del simulador no roban el foco.
  const keep = { onMouseDown: (e: MouseEvent) => e.preventDefault() }

  return (
    <div
      ref={panelRef}
      className="fixed right-3 bottom-3 z-[60] w-80 overflow-hidden dialog print:hidden"
    >
      <button
        type="button"
        {...keep}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center gap-2 bg-nav-bg px-3 py-2 text-left text-label text-nav-ink"
      >
        <Icon name="barcode" />
        <span className="flex-1">Simulador de lector</span>
        <Icon name={open ? 'chevron-down' : 'chevron-up'} />
      </button>
      {open && (
        <div className="max-h-[60vh] space-y-3 overflow-auto p-3">
          <p className="text-caption text-ink-muted">
            Escribe en el campo que tenga el foco, rápido y con Enter al final, como un lector USB.
            Para apagarlo abre la app con <code className="font-mono">?simulador=0</code>.
          </p>

          <div>
            <p className="mb-1 text-caption font-medium text-ink-subtle">Código nuevo</p>
            <button type="button" {...keep} onClick={() => { scan(newCode); setNewCode(randomEan13()) }} className={`${btn} font-mono`}>
              {newCode}
            </button>
          </div>

          {known.length > 0 && (
            <div>
              <p className="mb-1 text-caption font-medium text-ink-subtle">Productos existentes</p>
              <div className="space-y-1">
                {known.map((p) => (
                  <button key={p.barcode} type="button" {...keep} onClick={() => scan(p.barcode)} className={`${btn} block`}>
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="font-mono text-caption text-ink-muted">{p.barcode}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {known.some((p) => p.is_internal_code) && (
            <div>
              <p className="mb-1 text-caption font-medium text-ink-subtle">Lector con teclado de EE. UU.</p>
              {known
                .filter((p) => p.is_internal_code)
                .slice(0, 3)
                .map((p) => {
                  const wrong = p.barcode.replace('-', "'")
                  return (
                    <button key={wrong} type="button" {...keep} onClick={() => scan(wrong)} className={`${btn} block font-mono`}>
                      {wrong}
                    </button>
                  )
                })}
            </div>
          )}

          <div>
            <p className="mb-1 text-caption font-medium text-ink-subtle">Código personalizado</p>
            <div className="flex gap-1" data-keep-focus>
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                className="field h-control-sm min-w-0 flex-1 px-2 font-mono"
                placeholder="p. ej. 7501055300075"
              />
              <button
                type="button"
                {...keep}
                disabled={!custom.trim()}
                onClick={() => scan(custom.trim())}
                className="btn btn-primary btn-sm"
              >
                Escanear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
