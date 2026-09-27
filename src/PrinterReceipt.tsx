import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import type { Order } from './types'
import { money } from './types'

/* Renders the receipt onto a canvas with the Canvas2D API — zero DOM
   dependency, so the PNG download works everywhere, every time. */
function renderReceiptCanvas(order: Order, qrDataUrl: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const W = 500
    const rowH = 30
    const itemRows = order.items.length * 2
    const totalRows = 14 + itemRows
    const H = totalRows * rowH + 60

    const canvas = document.createElement('canvas')
    const scale = 2 // retina-sharp
    canvas.width = W * scale
    canvas.height = H * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      resolve(null)
      return
    }
    ctx.scale(scale, scale)

    const MONO = "'Courier New', monospace"
    // Paper background with faint thermal-band texture
    ctx.fillStyle = '#f8f1ea'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(210, 195, 178, 0.18)'
    for (let y = 0; y < H; y += 26) ctx.fillRect(0, y, W, 1)

    const center = (text: string, y: number, font = `700 16px ${MONO}`, color = '#2a2018') => {
      ctx.font = font
      ctx.fillStyle = color
      ctx.textAlign = 'center'
      ctx.fillText(text, W / 2, y)
    }
    const row = (left: string, right: string, y: number, bold = false) => {
      ctx.font = `${bold ? '700' : '400'} 14px ${MONO}`
      ctx.fillStyle = '#2a2018'
      ctx.textAlign = 'left'
      ctx.fillText(left, 30, y)
      ctx.textAlign = 'right'
      ctx.fillText(right, W - 30, y)
    }
    const dashed = (y: number) => {
      ctx.strokeStyle = '#8a7a66'
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(30, y)
      ctx.lineTo(W - 30, y)
      ctx.stroke()
      ctx.setLineDash([])
    }

    let y = 40
    center('★ FUZZY STORE ★', y, `800 20px ${MONO}`)
    y += rowH
    center('Imported snacks & spirits', y, `400 13px ${MONO}`, '#6b5a48')
    y += rowH
    dashed((y += 8))
    y += rowH
    row('Order', order.order_code, y)
    y += rowH
    row('Date', new Date(order.created_at).toLocaleString(), y)
    y += rowH
    row('Customer', order.customer_name, y)
    y += rowH
    row('Payment', order.payment_method, y)
    y += rowH
    dashed((y += 8))
    y += rowH
    for (const item of order.items) {
      ctx.font = `700 15px ${MONO}`
      ctx.fillStyle = '#2a2018'
      ctx.textAlign = 'left'
      ctx.fillText(`${item.name} × ${item.quantity}`, 30, y)
      y += rowH
      row('  unit', money(item.price), y)
      y += rowH
    }
    dashed((y += 8))
    y += 12
    row('TOTAL', money(order.total), y, true)
    y += rowH + 4
    dashed(y)
    y += rowH
    center('merci! thank you! misaotra!', y, `400 13px ${MONO}`)
    y += rowH
    center('see you soon at the store :)', y, `400 13px ${MONO}`)
    y += rowH + 16

    if (qrDataUrl) {
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, W / 2 - 80, y, 160, 160)
        center('show this to the cashier', y + 184, `400 13px ${MONO}`)
        canvas.toBlob((blob) => resolve(blob), 'image/png')
      }
      img.onerror = () => canvas.toBlob((blob) => resolve(blob), 'image/png')
      img.src = qrDataUrl
    } else {
      canvas.toBlob((blob) => resolve(blob), 'image/png')
    }
  })
}

/* Cute mini thermal printer that "prints" the receipt line by line,
   then offers a PNG download of the finished receipt. */

const PRINT_STEP_MS = 90

type ReceiptLine =
  | { kind: 'center' | 'item' | 'total'; text: string }
  | { kind: 'row'; left: string; right: string }
  | { kind: 'dashed' | 'gap' | 'qr' }

type Props = {
  order: Order
  onClose: () => void
}

export default function PrinterReceipt({ order, onClose }: Props) {
  const [printedLines, setPrintedLines] = useState(0)
  const [done, setDone] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const paperRef = useRef<HTMLDivElement>(null)

  const lines = useMemo<ReceiptLine[]>(
    () =>
      [
        { kind: 'center', text: '★ FUZZY STORE ★' },
        { kind: 'center', text: 'Imported snacks & spirits' },
        { kind: 'dashed' },
        { kind: 'row', left: 'Order', right: order.order_code },
        { kind: 'row', left: 'Date', right: new Date(order.created_at).toLocaleString() },
        { kind: 'row', left: 'Customer', right: order.customer_name },
        { kind: 'row', left: 'Payment', right: order.payment_method },
        { kind: 'dashed' },
        ...order.items.flatMap((item): ReceiptLine[] => [
          { kind: 'item', text: `${item.name} × ${item.quantity}` },
          { kind: 'row', left: '  unit', right: money(item.price) },
        ]),
        { kind: 'dashed' },
        { kind: 'total', text: money(order.total) },
        { kind: 'dashed' },
        { kind: 'center', text: 'merci! thank you! misaotra!' },
        { kind: 'center', text: 'see you soon at the store :)' },
        { kind: 'gap' },
        { kind: 'qr' },
        { kind: 'center', text: 'show this to the cashier' },
        { kind: 'gap' },
      ] as ReceiptLine[],
    [order],
  )

  // Generate the QR (encodes the order code + verification URL)
  useEffect(() => {
    const payload = `FUZZY-ORDER:${order.order_code}`
    QRCode.toDataURL(payload, { width: 240, margin: 1, color: { dark: '#1f1a1d', light: '#f8f1ea' } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''))
  }, [order.order_code])

  // Print tick
  useEffect(() => {
    if (printedLines >= lines.length) {
      setDone(true)
      return
    }
    const t = window.setTimeout(() => setPrintedLines((n) => n + 1), PRINT_STEP_MS)
    return () => window.clearTimeout(t)
  }, [printedLines, lines.length])

  // Keep the paper scrolled to the print head
  useEffect(() => {
    paperRef.current?.scrollTo({ top: paperRef.current.scrollHeight })
  }, [printedLines])

  const download = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      const blob = await renderReceiptCanvas(order, qrDataUrl)
      if (!blob) {
        showToastLike('Could not generate the receipt image on this device.')
        return
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.download = `fuzzy-receipt-${order.order_code}.png`
      link.href = url
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } finally {
      setDownloading(false)
    }
  }

  const showToastLike = (msg: string) => {
    const el = document.createElement('div')
    el.textContent = msg
    el.style.cssText =
      'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#2b1c10;color:#ffd9c4;padding:10px 18px;border-radius:10px;font-size:13px;z-index:99'
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 3000)
  }

  const visible = lines.slice(0, printedLines)

  return (
    <section className="printer-modal">
      <div className="printer-scene">
        <div className={`mini-printer ${done ? 'done' : 'printing'}`} aria-hidden="true">
          <div className="printer-body">
            <div className="printer-top">
              <span className="printer-led" />
              <span className="printer-brand">FUZZY·PRINT</span>
              <span className={`printer-status ${done ? 'ok' : ''}`}>{done ? 'READY' : 'PRINTING'}</span>
            </div>
            <div className="printer-face">
              <div className="printer-eye left" />
              <div className="printer-eye right" />
              <div className="printer-mouth" />
            </div>
            <div className="printer-slot">
              <div className="printer-slit" />
            </div>
          </div>
          <div className="printer-feet">
            <span /><span />
          </div>
        </div>

        <div className="paper-wrap" ref={paperRef}>
          <div className="paper" id="receipt-paper">
            {visible.map((line, i) => {
              switch (line.kind) {
                case 'dashed':
                  return <div className="p-dashed" key={i} />
                case 'gap':
                  return <div style={{ height: 10 }} key={i} />
                case 'total':
                  return (
                    <div className="p-total" key={i}>
                      <span>TOTAL</span>
                      <strong>{line.text}</strong>
                    </div>
                  )
                case 'qr':
                  return (
                    <div className="p-qr" key={i}>
                      {qrDataUrl ? <img src={qrDataUrl} alt={`QR code for order ${order.order_code}`} /> : <div className="p-qr-placeholder" />}
                    </div>
                  )
                case 'row':
                  return (
                    <div className="p-row" key={i}>
                      <span>{line.left}</span>
                      <span>{line.right}</span>
                    </div>
                  )
                case 'item':
                  return <div className="p-item" key={i}>{line.text}</div>
                default:
                  return <div className="p-center" key={i}>{line.text}</div>
              }
            })}
          </div>
        </div>
      </div>

      <div className="printer-actions">
        <button type="button" className="primary-button" disabled={!done || downloading} onClick={download}>
          {downloading ? 'Preparing…' : done ? '⬇ Download receipt' : 'Printing…'}
        </button>
        <button type="button" className="ghost-button" onClick={onClose}>
          Continue shopping
        </button>
      </div>
    </section>
  )
}
