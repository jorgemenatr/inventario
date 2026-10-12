import { useEffect, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import JsBarcode from 'jsbarcode'
import { formatMoney } from '../lib/format'
import { useInventory } from '../store/useInventory'

/** Etiqueta imprimible (Code128) para productos con código interno. */
export function LabelPage() {
  const { code = '' } = useParams()
  const [params] = useSearchParams()
  const svgRef = useRef<SVGSVGElement>(null)
  const product = useInventory().products[code]

  useEffect(() => {
    if (!svgRef.current || !code) return
    JsBarcode(svgRef.current, code, {
      format: 'CODE128',
      width: 2,
      height: 60,
      fontSize: 18,
      margin: 0,
      displayValue: true,
    })
    if (params.get('print') === '1') {
      const t = setTimeout(() => window.print(), 300)
      return () => clearTimeout(t)
    }
  }, [code, params])

  return (
    <div className="min-h-full bg-white p-6">
      <style>{`
        @page { size: 50mm 30mm; margin: 0; }
        @media print {
          html, body, #root { background: #fff; height: auto; }
          .label { width: 50mm; height: 30mm; padding: 1.5mm 2mm; border: none !important; margin: 0 !important; }
        }
      `}</style>
      <div className="mb-6 flex gap-3 print:hidden">
        <button type="button" onClick={() => window.print()} className="rounded-xl bg-blue-700 px-6 py-3 text-xl font-black text-white">
          🖨 Imprimir
        </button>
        <button type="button" onClick={() => window.close()} className="rounded-xl bg-slate-200 px-6 py-3 text-xl font-black">
          Cerrar
        </button>
        <p className="self-center text-slate-600">Tamaño de etiqueta: 50 × 30 mm. Ajusta la escala en el diálogo de impresión si hace falta.</p>
      </div>
      <div className="label mx-auto flex w-[50mm] flex-col items-center justify-center overflow-hidden border border-dashed border-slate-400 text-black" style={{ height: '30mm' }}>
        {product && <p className="w-full truncate text-center text-[9pt] font-bold leading-tight">{product.name}</p>}
        <svg ref={svgRef} className="h-auto max-w-full" />
        {product && <p className="text-[9pt] font-bold leading-tight">{formatMoney(product.price)}</p>}
      </div>
    </div>
  )
}
