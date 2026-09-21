import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import './App.css'

type CategoryKey =
  | 'all'
  | 'candies'
  | 'snacks'
  | 'fresh_drinks'
  | 'energy_drinks'
  | 'protein_snacks'
  | 'alcohol_cocktails'

type Product = {
  id: string
  name: string
  price: number
  stock: number
  available: boolean
  category: string
  image_url: string
  flavors: string[]
  description: string
}

type CartItem = {
  productId: string
  flavor?: string
  quantity: number
}

type OrderRecord = {
  id: string
  order_code: string
  customer_name: string
  customer_phone: string
  items: Array<{
    productId: string
    name: string
    flavor?: string
    quantity: number
    price: number
  }>
  total: number
  payment_method: string
  status: string
  created_at: string
}

type ReceiptState = OrderRecord & { qrDataUrl: string }

type CustomerForm = {
  customer_name: string
  customer_phone: string
  payment_method: 'cash' | 'mvola' | 'card'
}

const CATEGORY_ORDER: Array<{ key: CategoryKey; label: string; tone: string }> = [
  { key: 'all', label: 'All', tone: '#f2e8d8' },
  { key: 'candies', label: 'Candies', tone: '#e8b84b' },
  { key: 'snacks', label: 'Snacks', tone: '#d9a441' },
  { key: 'fresh_drinks', label: 'Fresh Drinks', tone: '#f5d9b7' },
  { key: 'energy_drinks', label: 'Energy Drinks', tone: '#c34b43' },
  { key: 'protein_snacks', label: 'Protein Snacks', tone: '#823d28' },
  { key: 'alcohol_cocktails', label: 'Alcohol Cocktails', tone: '#4b1d2d' },
]

const DEFAULT_CUSTOMER_FORM: CustomerForm = {
  customer_name: '',
  customer_phone: '',
  payment_method: 'cash',
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('fr-MG', {
    style: 'currency',
    currency: 'MGA',
    maximumFractionDigits: 0,
  }).format(value)

const parseFlavorValue = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  }

  if (typeof value === 'string') {
    if (value.trim().startsWith('[') || value.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(value)
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is string => typeof item === 'string')
        }
      } catch {
        return value.split(',').map((item) => item.trim()).filter(Boolean)
      }
    }
    return value.split(',').map((item) => item.trim()).filter(Boolean)
  }

  return []
}

const normalizeProduct = (raw: Record<string, unknown>): Product => {
  const categoryValue = String(raw.category ?? raw.product_category ?? 'snacks')

  return {
    id: String(raw.id ?? raw.product_id ?? crypto.randomUUID()),
    name: String(raw.name ?? 'Imported Product'),
    price: Number(raw.price ?? raw.amount ?? 0),
    stock: Number(raw.stock ?? raw.quantity ?? raw.inventory ?? 0),
    available: raw.available === undefined ? Number(raw.stock ?? raw.quantity ?? 0) > 0 : Boolean(raw.available),
    category: categoryValue,
    image_url: String(raw.image_url ?? raw.imageUrl ?? ''),
    flavors: parseFlavorValue(raw.flavors ?? raw.flavor_options ?? raw.flavor ?? raw.flavours),
    description: String(raw.description ?? 'Imported specialty product.'),
  }
}

const getSupabase = (): SupabaseClient | null => {
  const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '')
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  if (!url || !anonKey || !url.startsWith('https://')) {
    return null
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const readStorage = <T,>(key: string, fallback: T): T => {
  try {
    const value = localStorage.getItem(key)
    if (!value) return fallback
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const generateOrderCode = () => `FU-${Math.random().toString(36).slice(2, 8).toUpperCase()}`

function App() {
  const [products, setProducts] = useState<Product[]>([])
  const [isLoadingProducts, setIsLoadingProducts] = useState(true)
  const [productLoadError, setProductLoadError] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>('all')
  const [cart, setCart] = useState<CartItem[]>(() => readStorage<CartItem[]>('fuzzy-cart', []))
  const [checkoutForm, setCheckoutForm] = useState<CustomerForm>(DEFAULT_CUSTOMER_FORM)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cartOpen, setCartOpen] = useState(false)
  const [receipt, setReceipt] = useState<ReceiptState | null>(null)
  const [adminVisible, setAdminVisible] = useState(false)
  const [adminForm, setAdminForm] = useState({ email: 'admin@fuzzy.store', password: 'admin1234' })
  const [adminLoggedIn, setAdminLoggedIn] = useState(() => localStorage.getItem('fuzzy-admin') === 'true')
  const [adminOrders, setAdminOrders] = useState<OrderRecord[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [adminSearch, setAdminSearch] = useState('')
  const [adminStatusFilter, setAdminStatusFilter] = useState('all')
  const [scanMode, setScanMode] = useState<'manual' | 'camera' | 'idle'>('manual')
  const [scanCode, setScanCode] = useState('')
  const [scannerError, setScannerError] = useState('')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const productMap = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  )

  const cartTotals = useMemo(() => {
    const subtotal = cart.reduce((sum, item) => {
      const product = productMap.get(item.productId)
      if (!product) return sum
      return sum + product.price * item.quantity
    }, 0)

    return { subtotal, total: subtotal }
  }, [cart, productMap])

  const selectedOrder =
    adminOrders.find((order) => order.id === selectedOrderId) ??
    (adminOrders.length > 0 ? adminOrders[0] : null)

  useEffect(() => {
    localStorage.setItem('fuzzy-cart', JSON.stringify(cart))
  }, [cart])

  useEffect(() => {
    if (adminLoggedIn) {
      setReceipt(null)
      setSelectedOrderId(null)
      localStorage.setItem('fuzzy-admin', 'true')
      return
    }

    localStorage.setItem('fuzzy-admin', 'false')
  }, [adminLoggedIn])

  useEffect(() => {
    const loadProducts = async () => {
      setIsLoadingProducts(true)
      const supabase = getSupabase()
      if (!supabase) {
        setProductLoadError('Supabase is not configured in this deployment.')
        setIsLoadingProducts(false)
        return
      }

      try {
        const { data, error } = await supabase.from('products').select('*')
        if (!error && Array.isArray(data)) {
          setProducts(data.map((product) => normalizeProduct(product as Record<string, unknown>)))
          setIsLoadingProducts(false)
          return
        }

        setProductLoadError(error?.message ?? 'The products table returned an invalid response.')
      } catch {
        setProductLoadError('The storefront could not reach the Supabase products table.')
      }

      setIsLoadingProducts(false)
    }

    const loadOrders = async () => {
      const supabase = getSupabase()
      if (supabase) {
        try {
          const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false })
          if (!error && Array.isArray(data)) {
            const mapped = data.map((order) => ({
              id: String(order.id ?? crypto.randomUUID()),
              order_code: String(order.order_code ?? 'NO-CODE'),
              customer_name: String(order.customer_name ?? 'Guest'),
              customer_phone: String(order.customer_phone ?? ''),
              items: Array.isArray(order.items) ? order.items : [],
              total: Number(order.total ?? 0),
              payment_method: String(order.payment_method ?? 'cash'),
              status: String(order.status ?? 'pending'),
              created_at: String(order.created_at ?? new Date().toISOString()),
            }))
            setAdminOrders(mapped)
            return
          }
        } catch {
          // Continue with local fallback if the table is unavailable.
        }
      }

      const persisted = readStorage<OrderRecord[]>('fuzzy-orders', [])
      setAdminOrders(persisted)
    }

    void loadProducts()
    void loadOrders()
  }, [])

  useEffect(() => {
    if (scanMode !== 'camera') {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }
      return
    }

    let cancelled = false

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setScannerError('Camera access is unavailable in this browser.')
        setScanMode('manual')
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }

        const BarcodeDetectorCtor = (
          window as Window & {
            BarcodeDetector?: new (options?: { formats?: string[] }) => {
              detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>
            }
          }
        ).BarcodeDetector

        if (!BarcodeDetectorCtor) {
          setScannerError('Camera is available, but QR detection is not supported by this browser. Use manual entry instead.')
          return
        }

        const detector = new BarcodeDetectorCtor({ formats: ['qr_code'] })

        const tick = async () => {
          if (cancelled || !videoRef.current || !streamRef.current) return

          try {
            const barcodes = await detector.detect(videoRef.current)
            const value = barcodes[0]?.rawValue
            if (value) {
              setScanCode(value)
              setScanMode('manual')
              const match = adminOrders.find((order) => order.order_code === value)
              if (match) {
                setSelectedOrderId(match.id)
              }
              return
            }
          } catch {
            // Keep scanning while the device is active.
          }

          requestAnimationFrame(() => {
            void tick()
          })
        }

        void tick()
      } catch {
        setScannerError('Camera permission was denied or the device is unavailable.')
        setScanMode('manual')
      }
    }

    void startCamera()

    return () => {
      cancelled = true
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [scanMode, adminOrders])

  const filteredProducts =
    selectedCategory === 'all'
      ? products
      : products.filter((product) => product.category === selectedCategory)

  if (isLoadingProducts && products.length === 0) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="brand-block">
            <div className="brand-mark">FS</div>
            <div>
              <div className="brand-name">Fuzzy Store</div>
              <div className="brand-tag">Connecting to Supabase...</div>
            </div>
          </div>
        </header>

        <main className="page-shell">
          <section className="hero-section">
            <div className="hero-copy">
              <span className="eyebrow">Loading live inventory</span>
              <h1>Fetching the latest products from your store.</h1>
              <p>Please wait while the storefront syncs with the live Supabase catalog.</p>
            </div>
          </section>
        </main>
      </div>
    )
  }

  if (productLoadError && products.length === 0) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="brand-block">
            <div className="brand-mark">FS</div>
            <div>
              <div className="brand-name">Fuzzy Store</div>
              <div className="brand-tag">Live catalog unavailable</div>
            </div>
          </div>
        </header>

        <main className="page-shell">
          <section className="hero-section">
            <div className="hero-copy">
              <span className="eyebrow">Supabase connection error</span>
              <h1>The live products could not be loaded.</h1>
              <p>{productLoadError}</p>
            </div>
          </section>
        </main>
      </div>
    )
  }

  const addToCart = (product: Product, flavor?: string) => {
    if (product.flavors.length > 0 && !flavor) {
      setError(`Choose a flavor for ${product.name} before adding it to the cart.`)
      return
    }

    const existingItem = cart.find(
      (item) => item.productId === product.id && item.flavor === flavor,
    )

    if (existingItem && existingItem.quantity >= product.stock) {
      setError(`Only ${product.stock} units of ${product.name} are left in stock.`)
      return
    }

    setCart((current) => {
      if (existingItem) {
        return current.map((item) =>
          item.productId === product.id && item.flavor === flavor
            ? { ...item, quantity: Math.min(item.quantity + 1, product.stock) }
            : item,
        )
      }
      return [...current, { productId: product.id, flavor, quantity: 1 }]
    })

    setError('')
    setNotice(`${product.name} added to the cart.`)
  }

  const updateCartQuantity = (productId: string, delta: number, flavor?: string) => {
    setCart((current) =>
      current.flatMap((item) => {
        if (item.productId !== productId || item.flavor !== flavor) return [item]

        const nextQuantity = item.quantity + delta
        if (nextQuantity <= 0) return []

        const maxStock = productMap.get(productId)?.stock ?? item.quantity
        return [{ ...item, quantity: Math.min(nextQuantity, maxStock) }]
      }),
    )
  }

  const removeFromCart = (productId: string, flavor?: string) => {
    setCart((current) =>
      current.filter(
        (item) => !(item.productId === productId && item.flavor === flavor),
      ),
    )
  }

  const buildLineItems = () =>
    cart
      .map((item) => {
        const product = productMap.get(item.productId)
        if (!product) return null
        return {
          productId: item.productId,
          name: product.name,
          flavor: item.flavor,
          quantity: item.quantity,
          price: product.price,
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)

  const handleCheckout = async () => {
    if (!checkoutForm.customer_name.trim() || !checkoutForm.customer_phone.trim()) {
      setError('Add the customer name and phone number before placing the order.')
      return
    }

    if (cart.length === 0) {
      setError('Your cart is empty. Add a few favorites before checkout.')
      return
    }

    const validatedItems = buildLineItems()
    const stockIssues = validatedItems.filter((item) => {
      const product = productMap.get(item.productId)
      return !product || item.quantity > product.stock
    })

    if (stockIssues.length > 0) {
      setError('One or more products are no longer available in the requested quantity.')
      return
    }

    const total = validatedItems.reduce((sum, item) => sum + item.quantity * item.price, 0)
    const orderCode = generateOrderCode()
    const payload = {
      id: crypto.randomUUID(),
      order_code: orderCode,
      customer_name: checkoutForm.customer_name,
      customer_phone: checkoutForm.customer_phone,
      items: validatedItems,
      total,
      payment_method: checkoutForm.payment_method,
      status: 'pending',
      created_at: new Date().toISOString(),
    }

    let orderSaved = false
    const supabase = getSupabase()

    if (supabase) {
      try {
        const { data, error: insertError } = await supabase
          .from('orders')
          .insert([
            {
              id: payload.id,
              order_code: payload.order_code,
              customer_name: payload.customer_name,
              customer_phone: payload.customer_phone,
              items: payload.items,
              total: payload.total,
              payment_method: payload.payment_method,
              status: payload.status,
              created_at: payload.created_at,
            },
          ])
          .select('*')

        if (!insertError && Array.isArray(data) && data.length > 0) {
          orderSaved = true
          const updatedStock = validatedItems.map((item) => ({
            id: item.productId,
            stock: Math.max(0, (productMap.get(item.productId)?.stock ?? 0) - item.quantity),
          }))

          for (const nextProduct of updatedStock) {
            try {
              await supabase
                .from('products')
                .update({ stock: nextProduct.stock, available: nextProduct.stock > 0 })
                .eq('id', nextProduct.id)
            } catch {
              // Keep the order if the stock update is blocked by permissions or schema mismatch.
            }
          }
        }

        if (insertError) {
          console.error('Supabase order insert failed:', insertError)
          setNotice('Database order saving failed. Saving this order locally instead.')
        }
      } catch {
        setError('Unable to reach the Supabase project for this order. Please try again in a moment.')
        return
      }
    }

    if (!orderSaved) {
      const localOrders = readStorage<OrderRecord[]>('fuzzy-orders', [])
      const savedOrder: OrderRecord = {
        ...payload,
        id: payload.id,
      }
      localStorage.setItem('fuzzy-orders', JSON.stringify([savedOrder, ...localOrders]))
      setAdminOrders((current) => [savedOrder, ...current])
      setProducts((current) =>
        current.map((product) => {
          const selected = validatedItems.find((item) => item.productId === product.id)
          if (!selected) return product

          return {
            ...product,
            stock: Math.max(0, product.stock - selected.quantity),
            available: Math.max(0, product.stock - selected.quantity) > 0,
          }
        }),
      )
      orderSaved = true
    }

    if (!orderSaved) {
      setError('The order could not be confirmed by the database and was not saved.')
      return
    }

    const qrDataUrl = await QRCode.toDataURL(`https://fuzzystore.local/orders/${orderCode}`)
    setReceipt({ ...payload, qrDataUrl })
    setCart([])
    setCheckoutForm(DEFAULT_CUSTOMER_FORM)
    setNotice('Order placed successfully. Your receipt is ready below.')
    setError('')
  }

  const handleAdminLogin = (event: React.FormEvent) => {
    event.preventDefault()
    const adminEmail = import.meta.env.VITE_ADMIN_EMAIL ?? 'admin@fuzzy.store'
    const adminPassword = import.meta.env.VITE_ADMIN_PASSWORD ?? 'admin1234'

    if (adminForm.email === adminEmail && adminForm.password === adminPassword) {
      setAdminLoggedIn(true)
      setAdminVisible(true)
      setReceipt(null)
      setNotice('Admin access enabled.')
      return
    }

    setError('Incorrect admin credentials. Use the configured admin login.')
  }

  const updateOrderStatus = async (orderId: string, nextStatus: string) => {
    const supabase = getSupabase()
    if (supabase) {
      try {
        const { error } = await supabase.from('orders').update({ status: nextStatus }).eq('id', orderId)
        if (!error) {
          setAdminOrders((current) =>
            current.map((order) =>
              order.id === orderId ? { ...order, status: nextStatus } : order,
            ),
          )
          setSelectedOrderId(orderId)
          return
        }
      } catch {
        // Continue to local update fallback when the Supabase schema differs.
      }
    }

    const localOrders = readStorage<OrderRecord[]>('fuzzy-orders', [])
    const nextOrders = localOrders.map((order) =>
      order.id === orderId ? { ...order, status: nextStatus } : order,
    )
    localStorage.setItem('fuzzy-orders', JSON.stringify(nextOrders))
    setAdminOrders(nextOrders)
    setSelectedOrderId(orderId)
  }

  const filteredOrders = adminOrders.filter((order) => {
    const matchesSearch =
      adminSearch.trim() === '' ||
      [order.order_code, order.customer_name, order.customer_phone]
        .join(' ')
        .toLowerCase()
        .includes(adminSearch.toLowerCase())

    const matchesStatus =
      adminStatusFilter === 'all' || order.status === adminStatusFilter

    return matchesSearch && matchesStatus
  })

  const printReceipt = () => {
    if (!receipt) return
    const printWindow = window.open('', '_blank', 'width=420,height=720')
    if (!printWindow) return

    printWindow.document.write(`
      <html>
        <body style="font-family:Arial,sans-serif;background:#f4f1ee;padding:32px;">
          <div style="max-width:360px;margin:auto;background:white;padding:24px;border:1px solid #ddd;">
            <h2 style="text-align:center; margin:0 0 8px;">Fuzzy Store</h2>
            <p style="text-align:center; margin:0 0 12px;">Receipt</p>
            <p style="margin:0 0 6px;">Order: ${receipt.order_code}</p>
            <p style="margin:0 0 6px;">Name: ${receipt.customer_name}</p>
            <p style="margin:0 0 6px;">Phone: ${receipt.customer_phone}</p>
            <p style="margin:0 0 6px;">Payment: ${receipt.payment_method}</p>
            ${receipt.items
              .map(
                (item) =>
                  `<p style="margin:4px 0;">${item.name} ${item.flavor ? `(${item.flavor})` : ''} × ${item.quantity} — ${formatCurrency(item.price * item.quantity)}</p>`,
              )
              .join('')}
            <p style="margin-top:16px;font-weight:700;">Total: ${formatCurrency(receipt.total)}</p>
            <img src="${receipt.qrDataUrl}" style="width:140px;height:140px;display:block;margin:16px auto 0;" />
          </div>
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  const downloadReceipt = () => {
    if (!receipt) return
    const link = document.createElement('a')
    link.href = receipt.qrDataUrl
    link.download = `${receipt.order_code}-receipt.png`
    link.click()
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">FS</div>
          <div>
            <div className="brand-name">Fuzzy Store</div>
            <div className="brand-tag">Imported snacks & spirits</div>
          </div>
        </div>

        <nav className="category-nav" aria-label="Category navigation">
          {CATEGORY_ORDER.map((category) => (
            <button
              type="button"
              key={category.key}
              className={selectedCategory === category.key ? 'nav-pill active' : 'nav-pill'}
              onClick={() => setSelectedCategory(category.key)}
              style={category.key === 'all' ? undefined : { background: category.tone }}
            >
              {category.label}
            </button>
          ))}
        </nav>

        <div className="topbar-actions">
          <button type="button" className="secondary-button" onClick={() => setAdminVisible((current) => !current)}>
            {adminLoggedIn ? 'Admin' : 'Admin Login'}
          </button>
          <button type="button" className="cart-button" onClick={() => setCartOpen(true)}>
            Cart <span>{cart.reduce((sum, item) => sum + item.quantity, 0)}</span>
          </button>
        </div>
      </header>

      <main className="page-shell">
        <section className="hero-section">
          <div className="hero-copy">
            <span className="eyebrow">Madagascar imported energy</span>
            <h1>Curated bites, drinks and late-night favourites.</h1>
            <p>
              Fuzzy Store brings premium imported snacks, fresh juices, protein essentials,
              and a polished cocktail mood to your everyday ritual.
            </p>
            <div className="hero-actions">
              <button type="button" className="primary-button" onClick={() => setSelectedCategory('snacks')}>
                Shop the essentials
              </button>
            </div>
          </div>
          <div className="hero-card">
            <div className="hero-card-label">This week</div>
            <div className="hero-card-product">Mango-Lime Spark</div>
            <div className="hero-card-price">7,000 Ar</div>
          </div>
        </section>

        <section className="content-grid">
          <div className="product-panel">
            <div className="section-header">
              <h2>Featured collection</h2>
              <span>{filteredProducts.length} items</span>
            </div>

            <div className="product-grid">
              {filteredProducts.map((product) => (
                <article key={product.id} className="product-card">
                  <div className="product-image-wrap">
                    <img
                      src={product.image_url || 'https://placehold.co/600x400/2f1c2e/efe5d0?text=Fuzzy+Store'}
                      alt={product.name}
                      onError={(event) => {
                        event.currentTarget.src = 'https://placehold.co/600x400/2f1c2e/efe5d0?text=Fuzzy+Store'
                      }}
                    />
                    <span className="stock-pill">{product.stock} left</span>
                  </div>

                  <div className="product-body">
                    <div className="product-meta-row">
                      <span className="category-badge">{product.category}</span>
                      <span className="price">{formatCurrency(product.price)}</span>
                    </div>
                    <h3>{product.name}</h3>
                    <p>{product.description}</p>

                    {product.flavors.length > 0 && (
                      <div className="flavor-picker">
                        <label htmlFor={`flavor-${product.id}`}>Flavor</label>
                        <select id={`flavor-${product.id}`} defaultValue="">
                          <option value="">Select a flavor</option>
                          {product.flavors.map((flavor) => (
                            <option key={flavor} value={flavor}>
                              {flavor}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <button
                      type="button"
                      className="primary-button full-width"
                      disabled={product.stock <= 0}
                      onClick={() => {
                        const select = document.getElementById(`flavor-${product.id}`) as HTMLSelectElement | null
                        addToCart(product, select?.value || undefined)
                      }}
                    >
                      {product.stock <= 0 ? 'Out of stock' : 'Add to cart'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <aside className={`cart-panel ${cartOpen ? 'open' : ''}`}>
            <div className="cart-header">
              <h2>Your cart</h2>
              <button type="button" className="ghost-button" onClick={() => setCartOpen(false)}>
                Close
              </button>
            </div>

            {cart.length === 0 ? (
              <div className="empty-cart">
                <p>Your cart is empty.</p>
              </div>
            ) : (
              <>
                <div className="cart-items">
                  {cart.map((item) => {
                    const product = productMap.get(item.productId)
                    if (!product) return null

                    return (
                      <div key={`${item.productId}-${item.flavor ?? 'default'}`} className="cart-item">
                        <div>
                          <strong>{product.name}</strong>
                          {item.flavor && <span>{item.flavor}</span>}
                          <small>{formatCurrency(product.price)} each</small>
                        </div>
                        <div className="cart-item-actions">
                          <div className="quantity-stepper">
                            <button type="button" onClick={() => updateCartQuantity(item.productId, -1, item.flavor)}>
                              −
                            </button>
                            <span>{item.quantity}</span>
                            <button type="button" onClick={() => updateCartQuantity(item.productId, 1, item.flavor)}>
                              +
                            </button>
                          </div>
                          <button type="button" className="ghost-button" onClick={() => removeFromCart(item.productId, item.flavor)}>
                            Remove
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="totals-box">
                  <div>
                    <span>Subtotal</span>
                    <strong>{formatCurrency(cartTotals.subtotal)}</strong>
                  </div>
                  <div>
                    <span>Total</span>
                    <strong>{formatCurrency(cartTotals.total)}</strong>
                  </div>
                </div>

                <div className="checkout-form">
                  <label>
                    Customer name
                    <input
                      value={checkoutForm.customer_name}
                      onChange={(event) =>
                        setCheckoutForm((current) => ({
                          ...current,
                          customer_name: event.target.value,
                        }))
                      }
                      placeholder="Full name"
                    />
                  </label>

                  <label>
                    Customer phone
                    <input
                      value={checkoutForm.customer_phone}
                      onChange={(event) =>
                        setCheckoutForm((current) => ({
                          ...current,
                          customer_phone: event.target.value,
                        }))
                      }
                      placeholder="+261..."
                    />
                  </label>

                  <label>
                    Payment method
                    <select
                      value={checkoutForm.payment_method}
                      onChange={(event) =>
                        setCheckoutForm((current) => ({
                          ...current,
                          payment_method: event.target.value as CustomerForm['payment_method'],
                        }))
                      }
                    >
                      <option value="cash">Cash</option>
                      <option value="mvola">Mvola</option>
                      <option value="card">Card</option>
                    </select>
                  </label>

                  <button type="button" className="primary-button full-width" onClick={() => void handleCheckout()}>
                    Place order
                  </button>
                </div>
              </>
            )}
          </aside>
        </section>
      </main>

      {adminVisible && (
        <section className="panel admin-panel">
          {!adminLoggedIn ? (
            <form className="admin-signin" onSubmit={handleAdminLogin}>
              <h2>Admin access</h2>
              <label>
                Email
                <input
                  value={adminForm.email}
                  onChange={(event) => setAdminForm((current) => ({ ...current, email: event.target.value }))}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={adminForm.password}
                  onChange={(event) => setAdminForm((current) => ({ ...current, password: event.target.value }))}
                />
              </label>
              <button type="submit" className="primary-button">Sign in</button>
            </form>
          ) : (
            <div className="admin-dashboard">
              <div className="section-header admin-toolbar">
                <h2>Orders</h2>
                <div className="toolbar-controls">
                  <input
                    value={adminSearch}
                    onChange={(event) => setAdminSearch(event.target.value)}
                    placeholder="Search order code, name or phone"
                  />
                  <select value={adminStatusFilter} onChange={(event) => setAdminStatusFilter(event.target.value)}>
                    <option value="all">All</option>
                    <option value="pending">Pending</option>
                    <option value="validated">Validated</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              <div className="admin-qr-box">
                <div className="qr-controls">
                  <button type="button" className="secondary-button" onClick={() => setScanMode('camera')}>
                    Scan QR
                  </button>
                  <div className="manual-lookup">
                    <input
                      value={scanCode}
                      onChange={(event) => setScanCode(event.target.value)}
                      placeholder="Enter order code"
                    />
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        const match = adminOrders.find((order) => order.order_code === scanCode)
                        if (match) {
                          setSelectedOrderId(match.id)
                          setScanCode(match.order_code)
                          setNotice(`Order ${match.order_code} selected for validation.`)
                        } else {
                          setScannerError('No matching order code was found.')
                        }
                      }}
                    >
                      Open order
                    </button>
                  </div>
                </div>
                {scanMode === 'camera' && (
                  <div className="camera-box">
                    <video ref={videoRef} muted playsInline />
                  </div>
                )}
                {scannerError && <p className="error-text">{scannerError}</p>}
              </div>

              {selectedOrder && (
                <div className="selected-order-card">
                  <strong>Selected order:</strong> {selectedOrder.order_code}
                  <span> — {selectedOrder.customer_name}</span>
                </div>
              )}

              <div className="admin-order-list">
                {filteredOrders.length === 0 ? (
                  <p className="empty-state">No orders match this filter.</p>
                ) : (
                  filteredOrders.map((order) => (
                    <article
                      key={order.id}
                      className={selectedOrderId === order.id ? 'order-card selected' : 'order-card'}
                      onClick={() => setSelectedOrderId(order.id)}
                    >
                      <div className="order-card-header">
                        <div>
                          <strong>{order.order_code}</strong>
                          <span>{order.customer_name}</span>
                        </div>
                        <span className={`status-badge ${order.status}`}>{order.status}</span>
                      </div>
                      <div className="order-card-body">
                        <p>{order.customer_phone}</p>
                        <p>{formatCurrency(order.total)}</p>
                        <p>{new Date(order.created_at).toLocaleString()}</p>
                      </div>
                      <div className="order-actions">
                        <button type="button" className="secondary-button" onClick={() => updateOrderStatus(order.id, 'validated')}>
                          Validate
                        </button>
                        <button type="button" className="ghost-button" onClick={() => updateOrderStatus(order.id, 'cancelled')}>
                          Cancel
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>

              <div className="admin-stock-panel">
                <h3>Stock overview</h3>
                <div className="stock-list">
                  {products.map((product) => (
                    <div key={product.id} className="stock-row">
                      <span>{product.name}</span>
                      <input
                        type="number"
                        min={0}
                        value={product.stock}
                        onChange={(event) => {
                          const nextStock = Number(event.target.value)
                          setProducts((current) =>
                            current.map((item) =>
                              item.id === product.id
                                ? { ...item, stock: nextStock, available: nextStock > 0 }
                                : item,
                            ),
                          )
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {receipt && (
        <section className="receipt-panel panel">
          <div className="receipt-box">
            <div className="receipt-header">
              <div>
                <span className="eyebrow">Order confirmation</span>
                <h3>Fuzzy Store</h3>
              </div>
              <span className="receipt-order">{receipt.order_code}</span>
            </div>

            <div className="receipt-body">
              <div className="receipt-meta">
                <p>{new Date(receipt.created_at).toLocaleString()}</p>
                <p>{receipt.customer_name}</p>
                <p>{receipt.customer_phone}</p>
              </div>

              <div className="receipt-items">
                {receipt.items.map((item) => (
                  <div key={`${item.productId}-${item.flavor ?? 'default'}`} className="receipt-item">
                    <span>
                      {item.name}
                      {item.flavor ? ` • ${item.flavor}` : ''}
                    </span>
                    <span>
                      {item.quantity} × {formatCurrency(item.price)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="receipt-total">
                <span>Total</span>
                <strong>{formatCurrency(receipt.total)}</strong>
              </div>
              <div className="receipt-payment">{receipt.payment_method}</div>
            </div>

            <div className="receipt-qr-block">
              <img src={receipt.qrDataUrl} alt="Order QR code" />
            </div>

            <div className="receipt-actions">
              <button type="button" className="primary-button" onClick={printReceipt}>
                Print receipt
              </button>
              <button type="button" className="secondary-button" onClick={downloadReceipt}>
                Download receipt
              </button>
              <button type="button" className="ghost-button" onClick={() => setReceipt(null)}>
                Continue shopping
              </button>
            </div>
          </div>
        </section>
      )}

      {(error || notice) && (
        <div className={`toast ${error ? 'error' : 'info'}`}>
          {error || notice}
        </div>
      )}
    </div>
  )
}

export default App
