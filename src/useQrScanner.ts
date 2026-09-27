import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

/* Camera QR scanner — works in EVERY browser.
   Fast path: native BarcodeDetector (Chrome/Android).
   Universal path: jsQR decoding canvas frames (Safari, Firefox, iOS). */

type ScannerStatus = 'idle' | 'starting' | 'scanning' | 'denied' | 'error'

export function useQrScanner(onDetected: (text: string) => void) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number>(0)
  const stoppedRef = useRef<boolean>(false)
  const [status, setStatus] = useState<ScannerStatus>('idle')
  const [lastError, setLastError] = useState<string>('')

  const stop = useCallback(() => {
    stoppedRef.current = true
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setStatus('idle')
  }, [])

  const start = useCallback(async () => {
    setLastError('')
    setStatus('starting')
    stoppedRef.current = false

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
    } catch (err) {
      const name = (err as DOMException)?.name
      if (name === 'NotAllowedError') setStatus('denied')
      else {
        setStatus('error')
        setLastError((err as Error)?.message ?? 'Could not access the camera')
      }
      return
    }

    streamRef.current = stream
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream
    video.setAttribute('playsinline', 'true') // iOS Safari
    try {
      await video.play()
    } catch {
      // Autoplay policies — the user gesture that started the scan usually covers this
    }

    // Native detector when available (fastest)
    const NativeDetector = (window as unknown as {
      BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (s: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> }
    }).BarcodeDetector
    const native = NativeDetector ? new NativeDetector({ formats: ['qr_code'] }) : null

    // jsQR fallback canvas
    if (!canvasRef.current) canvasRef.current = document.createElement('canvas')
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    let lastResult = ''
    let lastTime = 0
    let frameCount = 0

    const tick = async () => {
      if (stoppedRef.current || !streamRef.current || !videoRef.current) return

      try {
        if (native) {
          const codes = await native.detect(videoRef.current)
          if (codes.length > 0) emit(codes[0].rawValue)
        } else if (ctx && videoRef.current.videoWidth > 0) {
          // Decode every other frame — plenty fast, easier on the battery
          if (frameCount++ % 2 === 0) {
            const w = 480
            const h = Math.round((videoRef.current.videoHeight / videoRef.current.videoWidth) * w)
            canvas.width = w
            canvas.height = h
            ctx.drawImage(videoRef.current, 0, 0, w, h)
            const imageData = ctx.getImageData(0, 0, w, h)
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'dontInvert',
            })
            if (code?.data) emit(code.data)
          }
        }
      } catch {
        // transient decode errors are fine
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    const emit = (value: string) => {
      const now = Date.now()
      // Debounce the same code within 3s
      if (value !== lastResult || now - lastTime > 3000) {
        lastResult = value
        lastTime = now
        onDetected(value)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    setStatus('scanning')
  }, [onDetected])

  useEffect(() => () => stop(), [stop])

  return { videoRef, status, lastError, start, stop }
}
