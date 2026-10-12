// Sonidos generados con Web Audio (sin archivos): éxito, producto nuevo, error.
let ctx: AudioContext | null = null

function audio() {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(freq: number, start: number, duration: number, type: OscillatorType = 'sine', volume = 0.25) {
  const ac = audio()
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.value = freq
  const t0 = ac.currentTime + start
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(gain).connect(ac.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.02)
}

function safe(fn: () => void) {
  try {
    fn()
  } catch {
    /* sin audio disponible: no es crítico */
  }
}

export const sounds = {
  success: () => safe(() => tone(1320, 0, 0.12)),
  newProduct: () =>
    safe(() => {
      tone(660, 0, 0.12)
      tone(990, 0.13, 0.18)
    }),
  pending: () =>
    safe(() => {
      tone(880, 0, 0.1, 'triangle')
      tone(880, 0.14, 0.1, 'triangle')
    }),
  error: () =>
    safe(() => {
      tone(180, 0, 0.18, 'square', 0.18)
      tone(140, 0.2, 0.25, 'square', 0.18)
    }),
}
