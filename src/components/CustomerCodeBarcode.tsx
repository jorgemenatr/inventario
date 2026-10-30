import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'

/** Código de barras (Code128) del código de cliente, para escanearlo desde la pantalla o imprimirlo. */
export function CustomerCodeBarcode({ code }: { code: string }) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current) return
    JsBarcode(svgRef.current, code, { format: 'CODE128', width: 2, height: 56, fontSize: 16, margin: 8, displayValue: true })
  }, [code])

  return <svg ref={svgRef} className="h-auto max-w-full bg-white" aria-label={`Código de barras ${code}`} />
}
