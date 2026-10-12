import { useEffect, useState } from 'react'
import { getSignedImageUrl } from '../lib/images'

interface Props {
  path: string | null
  alt: string
  className?: string
}

/** Muestra una imagen del bucket privado usando una URL firmada temporal. */
export function ProductImage({ path, alt, className = '' }: Props) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setUrl(null)
    setFailed(false)
    if (path) void getSignedImageUrl(path).then((u) => active && setUrl(u))
    return () => {
      active = false
    }
  }, [path])

  if (!url || failed) {
    return (
      <div className={`grid place-items-center bg-slate-200 text-slate-400 ${className}`} aria-label="Sin imagen">
        <svg viewBox="0 0 24 24" className="h-1/2 w-1/2" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="9" cy="10" r="2" />
          <path d="m21 16-5-5-8 8" />
        </svg>
      </div>
    )
  }
  return <img src={url} alt={alt} onError={() => setFailed(true)} className={`object-contain bg-white ${className}`} />
}
