import { useEffect, useRef, useState } from 'react'

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
    <div className="space-y-3 rounded-xl border-2 border-slate-300 bg-slate-900 p-3">
      {error ? (
        <p className="p-4 text-lg font-semibold text-red-300">{error}</p>
      ) : (
        <video ref={videoRef} className="mx-auto max-h-72 rounded-lg" muted playsInline />
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={capture}
          disabled={!ready}
          className="flex-1 rounded-lg bg-emerald-600 px-4 py-3 text-lg font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          Tomar foto
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-slate-600 px-4 py-3 text-lg font-bold text-white hover:bg-slate-700"
        >
          Cerrar cámara
        </button>
      </div>
    </div>
  )
}
