/*
 * Logos de Kanan (design system Kanan, carpeta Logos). Polígonos planos; los
 * colores salen de los tokens para seguir el tema.
 * - KananMark: el ícono, la K extruida sobre un cuadrado de marca.
 * - KananLogo: la palabra KANAN dentro del contenedor extruido.
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

/** Alto en px; el ancho sale de la proporción del logo (711×221). */
export function KananLogo({ height = 40, className = '' }: { height?: number; className?: string }) {
  const face = 'var(--color-brand)'
  const ink = 'var(--color-on-brand)'
  return (
    <svg
      viewBox="146 278 711 221"
      height={height}
      width={(height * 711) / 221}
      className={className}
      role="img"
      aria-label="Kanan"
    >
      <polygon points="176,278 857,278 857,468 827,499 146,499 146,308" fill="var(--color-brand-side)" />
      <rect x="176" y="278" width="681" height="190" fill={face} />
      <polygon points={K} fill={ink} />
      <polygon points="336,305 422,305 432,315 432,441 394,441 394,403 364,403 364,441 326,441 326,315" fill={ink} />
      <polygon points="364,337 394,337 394,370 364,370" fill={face} />
      <polygon points="595,305 681,305 691,315 691,441 653,441 653,403 623,403 623,441 585,441 585,315" fill={ink} />
      <polygon points="623,337 653,337 653,370 623,370" fill={face} />
      <polygon points="449,305 489,305 530,372 530,305 568,305 568,441 528,441 487,374 487,441 449,441" fill={ink} />
      <polygon points="709,305 749,305 790,372 790,305 828,305 828,441 788,441 747,374 747,441 709,441" fill={ink} />
    </svg>
  )
}
