import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import type { Order } from './types'
import { money } from './types'

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
  const paperInnerRef = useRef<HTMLDivElement>(null)

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
    // Rasterize the full receipt paper (not the scroll-clipped wrapper)
    const node = paperInnerRef.current
    if (!node || downloading) return
    setDownloading(true)
    try {
      const { default: htmlToImage } = await import('html-to-image')
      const dataUrl = await htmlToImage.toPng(node, {
        pixelRatio: 2,
        backgroundColor: '#f8f1ea',
        cacheBust: true,
      })
      const link = document.createElement('a')
      link.download = `fuzzy-receipt-${order.order_code}.png`
      link.href = dataUrl
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch {
      // Fallback: open a printable window with the receipt text
      const win = window.open('', '_blank')
      if (win) {
        win.document.write(
          `<html><head><title>Fuzzy receipt ${order.order_code}</title></head>` +
          `<body style="background:#f8f1ea"><pre style="font-family:'Courier New',monospace;font-size:13px;padding:24px;white-space:pre-wrap">${node.innerText.replace(/[<>&]/g, '')}</pre>` +
          `${qrDataUrl ? `<img src="${qrDataUrl}" width="180" style="display:block;margin:0 auto"/>` : ''}</body></html>`,
        )
        win.document.close()
        setTimeout(() => win.print(), 300)
      }
    } finally {
      setDownloading(false)
    }
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
          <div className="paper" id="receipt-paper" ref={paperInnerRef}>
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
