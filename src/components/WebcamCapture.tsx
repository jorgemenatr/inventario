import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

interface Props {
  onCapture: (blob: Blob) => void
  onClose: () => void
}

/** Captura una foto con la webcam (requiere HTTPS o localhost). */
export function WebcamCapture({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Este navegador no permite usar la cámara (se necesita HTTPS).')
      return
    }
    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play().then(() => setReady(true))
        }
      })
      .catch((e: DOMException) => {
        setError(
          e.name === 'NotAllowedError'
            ? 'Permiso de cámara denegado. Actívalo en la barra de direcciones del navegador.'
            : e.name === 'NotFoundError'
              ? 'No se encontró ninguna cámara.'
              : `No se pudo abrir la cámara: ${e.message}`,
        )
      })
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  function capture() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    canvas.toBlob((blob) => blob && onCapture(blob), 'image/jpeg', 0.9)
  }

  return (
    <div className="space-y-3 rounded-lg border border-line bg-subtle p-3">
      {error ? (
        <p className="notice bg-danger-bg text-danger-fg">
          <Icon name="alert" className="mt-0.5" />
          {error}
        </p>
      ) : (
        <video ref={videoRef} className="mx-auto max-h-72 rounded-md bg-black" muted playsInline />
      )}
      <div className="flex gap-2">
        <button type="button" onClick={capture} disabled={!ready} className="btn btn-primary flex-1">
          <Icon name="camera" />
          Tomar foto
        </button>
        <button type="button" onClick={onClose} className="btn btn-secondary">
          Cerrar cámara
        </button>
      </div>
    </div>
  )
}
