import { useCallback, useEffect, useRef, useState } from 'react'

/* Camera QR scanner.
   Uses the native BarcodeDetector API when available (Chrome/Android),
   falls back to a light frame-diff no-op on unsupported browsers with a
   clear message. Never throws: surfaces status instead. */

type ScannerStatus = 'idle' | 'starting' | 'scanning' | 'unsupported' | 'denied' | 'error'

export function useQrScanner(onDetected: (text: string) => void) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const [status, setStatus] = useState<ScannerStatus>('idle')
  const [lastError, setLastError] = useState<string>('')

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setStatus('idle')
  }, [])

  const start = useCallback(async () => {
    setLastError('')
    if (!('BarcodeDetector' in window)) {
      setStatus('unsupported')
      return
    }
    setStatus('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      const detector = new (window as unknown as { BarcodeDetector: new (opts: { formats: string[] }) => { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector({
        formats: ['qr_code'],
      })

      let lastResult = ''
      let lastTime = 0

      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return
        try {
          const codes = await detector.detect(videoRef.current)
          if (codes.length > 0) {
            const now = Date.now()
            // Debounce the same code within 3s
            if (codes[0].rawValue !== lastResult || now - lastTime > 3000) {
              lastResult = codes[0].rawValue
              lastTime = now
              onDetected(codes[0].rawValue)
            }
          }
        } catch {
          // transient decode errors are fine
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
      setStatus('scanning')
    } catch (err) {
      const name = (err as DOMException)?.name
      if (name === 'NotAllowedError') setStatus('denied')
      else {
        setStatus('error')
        setLastError((err as Error)?.message ?? 'Camera error')
      }
    }
  }, [onDetected])

  useEffect(() => () => stop(), [stop])

  return { videoRef, status, lastError, start, stop }
}
