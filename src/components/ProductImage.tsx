import { useEffect, useState } from 'react'
import { getSignedImageUrl } from '../lib/images'
import { Icon } from './Icon'

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
      <div className={`grid place-items-center border border-line bg-subtle text-ink-subtle ${className}`} role="img" aria-label="Sin imagen">
        <Icon name="image" size={24} className="h-2/5 w-2/5" />
      </div>
    )
  }
  return <img src={url} alt={alt} onError={() => setFailed(true)} className={`border border-line bg-white object-contain ${className}`} />
}
