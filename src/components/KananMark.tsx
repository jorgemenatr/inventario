/*
 * Ícono de Kanan: la K extruida sobre un cuadrado de marca (kanan-icono.svg del
 * design system). Los colores salen de los tokens para seguir el tema.
 */
const K = '205,305 243,305 243,363 273,333 273,305 311,305 311,345 284,372 311,399 311,441 273,441 273,413 243,383 243,441 205,441'

export function KananMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} className={className} aria-hidden>
      <rect width="512" height="512" rx="96" fill="var(--color-brand)" />
      <g transform="translate(270 242) scale(2.2) translate(-258 -373)">
        {Array.from({ length: 14 }, (_, i) => (
          <polygon key={i} points={K} transform={`translate(${-(14 - i)} ${14 - i})`} fill="var(--color-brand-side)" />
        ))}
        <polygon points={K} fill="var(--color-on-brand)" />
      </g>
    </svg>
  )
}
