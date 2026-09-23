import { useEffect, useMemo, useState } from 'react'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import './App.css'

const getSupabase = (): SupabaseClient | null => {
  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  if (!url || !anonKey || !url.startsWith('https://')) {
    return null
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const supabase = getSupabase()

type Category = 'all' | 'candies' | 'snacks' | 'fresh_drinks' | 'energy_drinks' | 'protein_snacks' | 'alcohol_cocktails'

type Product = {
  id: string
  name: string
  price: number
  stock: number
  available: boolean
  category: string
  image_url?: string
  description: string
}

type CartItem = {
  productId: string
  name: string
  price: number
  quantity: number
}

type Order = {
  id: string
  order_code: string
  customer_name: string
  customer_phone: string
  items: CartItem[]
  total: number
  payment_method: string
  status: 'pending' | 'validated' | 'cancelled'
  created_at: string
}

const categories: Array<{ key: Category; label: string }> = [
  { key: 'all', label: 'All products' },
  { key: 'candies', label: 'Candies' },
  { key: 'snacks', label: 'Snacks' },
  { key: 'fresh_drinks', label: 'Fresh drinks' },
  { key: 'energy_drinks', label: 'Energy drinks' },
  { key: 'protein_snacks', label: 'Protein snacks' },
  { key: 'alcohol_cocktails', label: 'Alcohol & cocktails' },
]

const defaultProducts: Product[] = [
  {
    id: 'gatorade-red',
    name: 'Gatorade',
    price: 20000,
    stock: 10,
    available: true,
    category: 'energy_drinks',
    description: 'Imported performance drink with a bright citrus finish.',
  },
  {
    id: 'monster',
    name: 'Monster',
    price: 14000,
    stock: 30,
    available: true,
    category: 'energy_drinks',
    description: 'Classic energy boost with bold flavor and intense kick.',
  },
  {
    id: 'redbull',
    name: 'RedBull',
    price: 13000,
    stock: 10,
    available: true,
    category: 'energy_drinks',
    description: 'Smooth, crisp energy can made for busy days and nights.',
  },
  {
    id: 'kom-vida',
    name: 'Kom Vida',
    price: 18000,
    stock: 8,
    available: true,
    category: 'fresh_drinks',
    description: 'Imported specialty product with a clean, bright profile.',
  },
  {
    id: 'vitamin-well',
    name: 'Vitamin Well Reload',
    price: 30000,
    stock: 20,
    available: true,
    category: 'protein_snacks',
    description: 'Hydration and nutrients in a premium wellness blend.',
  },
]

const defaultOrders: Order[] = [
  {
    id: '1',
    order_code: 'FU-ALPHA1',
    customer_name: 'Nadia',
    customer_phone: '+261 34 11 22 33',
    items: [{ productId: 'gatorade-red', name: 'Gatorade', price: 20000, quantity: 1 }],
    total: 20000,
    payment_method: 'cash',
    status: 'pending',
    created_at: new Date().toISOString(),
  },
  {
    id: '2',
    order_code: 'FU-BRAVO2',
    customer_name: 'Mihaja',
    customer_phone: '+261 32 99 00 10',
    items: [{ productId: 'monster', name: 'Monster', price: 14000, quantity: 2 }],
    total: 28000,
    payment_method: 'mvola',
    status: 'validated',
    created_at: new Date(Date.now() - 3600000).toISOString(),
  },
]

const money = (value: number) =>
  new Intl.NumberFormat('fr-MG', {
    style: 'currency',
    currency: 'MGA',
    maximumFractionDigits: 0,
  }).format(value)

const readCart = (): CartItem[] => {
  try {
    const raw = localStorage.getItem('fuzzy-cart')
    return raw ? (JSON.parse(raw) as CartItem[]) : []
  } catch {
    return []
  }
}

const normalizeProduct = (raw: Record<string, unknown>): Product => ({
  id: String(raw.id ?? crypto.randomUUID()),
  name: String(raw.name ?? 'Imported Product'),
  price: Number(raw.price ?? raw.amount ?? 0),
  stock: Number(raw.stock ?? raw.quantity ?? raw.inventory ?? 0),
  available: raw.available === undefined ? Number(raw.stock ?? 0) > 0 : Boolean(raw.available),
  category: String(raw.category ?? raw.product_category ?? 'snacks'),
  image_url: String(raw.image_url ?? raw.imageUrl ?? ''),
  description: String(raw.description ?? 'Imported specialty product.'),
})

const productPlaceholder =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="%23f3efe9"/><text x="50%" y="50%" text-anchor="middle" fill="%23b6a58c" font-family="sans-serif" font-size="28">FS</text></svg>',
  )

function App() {
  const [products, setProducts] = useState<Product[]>(defaultProducts)
  const [orders, setOrders] = useState<Order[]>(defaultOrders)
  const [productLoadError, setProductLoadError] = useState<string | null>(null)
  const [category, setCategory] = useState<Category>('all')
  const [cart, setCart] = useState<CartItem[]>(readCart)
  const [cartOpen, setCartOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [payment, setPayment] = useState('cash')
  const [adminOpen, setAdminOpen] = useState(false)
  const [adminLoggedIn, setAdminLoggedIn] = useState(() => localStorage.getItem('fuzzy-admin') === 'true')
  const [credentials, setCredentials] = useState({ email: 'admin@fuzzy.store', password: 'admin1234' })
  const [toast, setToast] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<Order | null>(null)

  useEffect(() => {
    if (!supabase) {
      setProductLoadError('Supabase is not configured on this deployment (missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
      return
    }

    let cancelled = false

    ;(async () => {
      const { data, error } = await supabase.from('products').select('*')
      if (cancelled) return

      if (error) {
        setProductLoadError(`Could not load products from Supabase: ${error.message}`)
        return
      }

      if (Array.isArray(data) && data.length > 0) {
        setProducts(data.map(normalizeProduct))
        setProductLoadError(null)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('fuzzy-cart', JSON.stringify(cart))
  }, [cart])

  useEffect(() => {
    localStorage.setItem('fuzzy-admin', String(adminLoggedIn))
  }, [adminLoggedIn])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2500)
    return () => window.clearTimeout(timer)
  }, [toast])

  const filteredProducts = useMemo(
    () =>
      (category === 'all' ? products : products.filter((product) => product.category === category)).filter(
        (product) => product.available !== false,
      ),
    [category, products],
  )

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)

  const addToCart = (product: Product) => {
    setCart((current) => {
      const existing = current.find((item) => item.productId === product.id)
      if (existing) {
        return current.map((item) =>
          item.productId === product.id ? { ...item, quantity: Math.min(item.quantity + 1, product.stock) } : item,
        )
      }
      return [...current, { productId: product.id, name: product.name, price: product.price, quantity: 1 }]
    })
    setToast(`${product.name} added to cart`)
  }

  const placeOrder = async () => {
    if (!name.trim() || !phone.trim() || cart.length === 0) {
      setToast('Add a product and enter your details before placing an order.')
      return
    }

    const newOrder: Order = {
      id: crypto.randomUUID(),
      order_code: `FU-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      customer_name: name.trim(),
      customer_phone: phone.trim(),
      items: cart,
      total,
      payment_method: payment,
      status: 'pending',
      created_at: new Date().toISOString(),
    }

    if (supabase) {
      const { error: insertError } = await supabase.from('orders').insert([
        {
          id: newOrder.id,
          order_code: newOrder.order_code,
          customer_name: newOrder.customer_name,
          customer_phone: newOrder.customer_phone,
          items: newOrder.items,
          total: newOrder.total,
          payment_method: newOrder.payment_method,
          status: newOrder.status,
          created_at: newOrder.created_at,
        },
      ])

      if (insertError) {
        setToast(`Order could not be saved: ${insertError.message}`)
        return
      }

      for (const item of cart) {
        const product = products.find((entry) => entry.id === item.productId)
        if (!product) continue
        try {
          await supabase
            .from('products')
            .update({ stock: Math.max(0, product.stock - item.quantity), available: product.stock - item.quantity > 0 })
            .eq('id', product.id)
        } catch {
          // Keep the order even if the stock update is blocked by permissions.
        }
      }
    }

    setOrders((current) => [newOrder, ...current])
    setReceipt(newOrder)
    setCart([])
    setName('')
    setPhone('')
    setPayment('cash')
    setCartOpen(false)
    setToast('Order placed successfully.')
  }

  useEffect(() => {
    if (!adminLoggedIn || !supabase) return

    ;(async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })

      if (!error && Array.isArray(data) && data.length > 0) {
        setOrders(data as Order[])
      }
    })()
  }, [adminLoggedIn])

  const updateOrderStatus = async (id: string, status: 'validated' | 'cancelled') => {
    setOrders((current) =>
      current.map((order) => (order.id === id ? { ...order, status } : order)),
    )
    setToast(`Order updated to ${status}.`)

    if (supabase) {
      try {
        await supabase.from('orders').update({ status }).eq('id', id)
      } catch {
        // Keep the optimistic update if the write is blocked by permissions.
      }
    }
  }

  const loginAdmin = (event: React.FormEvent) => {
    event.preventDefault()
    const email = import.meta.env.VITE_ADMIN_EMAIL ?? 'admin@fuzzy.store'
    const password = import.meta.env.VITE_ADMIN_PASSWORD ?? 'admin1234'

    if (credentials.email === email && credentials.password === password) {
      setAdminLoggedIn(true)
      setAdminOpen(false)
      setToast('Admin access granted.')
      return
    }

    setToast('Incorrect admin credentials.')
  }

  if (adminLoggedIn) {
    return (
      <div className="admin-shell">
        <header className="admin-header">
          <div>
            <small>FUZZY STORE / OPERATIONS</small>
            <h1>Order control center</h1>
            <p>Review and manage incoming orders.</p>
          </div>
          <button type="button" className="secondary-button" onClick={() => setAdminLoggedIn(false)}>
            Log out
          </button>
        </header>

        <main className="admin-content">
          <section className="admin-tools">
            <h2>Find an order</h2>
            <div className="manual-lookup">
              <input type="text" placeholder="Order code e.g. FU-ABC123" />
              <button type="button" className="primary-button">
                Open order
              </button>
            </div>
          </section>

          <section className="admin-orders">
            <div className="section-header admin-section-header">
              <h2>Orders</h2>
              <span>{orders.length} total</span>
            </div>

            {orders.length === 0 ? (
              <p className="empty-state">No orders yet.</p>
            ) : (
              orders.map((order) => (
                <article className="order-card" key={order.id}>
                  <div className="order-card-header">
                    <div>
                      <strong>{order.order_code}</strong>
                      <span>
                        {order.customer_name} · {order.customer_phone}
                      </span>
                    </div>
                    <span className={`status-badge ${order.status}`}>{order.status}</span>
                  </div>

                  <div className="order-card-body">
                    <p>{money(order.total)}</p>
                    <p>{new Date(order.created_at).toLocaleString()}</p>
                  </div>

                  <div className="order-actions">
                    <button
                      type="button"
                      className="primary-button"
                      disabled={order.status === 'validated'}
                      onClick={() => updateOrderStatus(order.id, 'validated')}
                    >
                      Validate
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={order.status === 'cancelled'}
                      onClick={() => updateOrderStatus(order.id, 'cancelled')}
                    >
                      Cancel
                    </button>
                  </div>
                </article>
              ))
            )}
          </section>
        </main>

        {toast && <div className="toast info">{toast}</div>}
      </div>
    )
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

        <nav className="category-nav" aria-label="Product categories">
          {categories.map((item) => (
            <button
              type="button"
              key={item.key}
              className={category === item.key ? 'nav-pill active' : 'nav-pill'}
              onClick={() => setCategory(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="topbar-actions">
          <button type="button" className="secondary-button" onClick={() => setAdminOpen(true)}>
            Admin Login
          </button>
          <button type="button" className="cart-button" onClick={() => setCartOpen(true)}>
            Cart ({cart.reduce((sum, item) => sum + item.quantity, 0)})
          </button>
        </div>
      </header>

      <main className="page-shell">
        {productLoadError && (
          <div className="db-warning" role="alert">
            ⚠️ {productLoadError}
          </div>
        )}
        <section className="hero-section">
          <div className="hero-copy">
            <span className="eyebrow">A little joy, delivered</span>
            <h1>Good snacks. Great moments.</h1>
            <p>Explore imported favourites, fresh drinks and late-night treats.</p>
            <div className="hero-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => window.document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })}
              >
                Explore collection
              </button>
            </div>
          </div>
          <div className="hero-card">
            <div className="hero-card-label">Best seller</div>
            <div className="hero-card-product">Kom Vida</div>
            <div className="hero-card-price">18 000 Ar</div>
          </div>
        </section>

        <section id="products" className="content-grid">
          <div className="product-panel">
            <div className="section-header">
              <h2>Products</h2>
              <span>{filteredProducts.length} items</span>
            </div>

            <div className="product-grid">
              {filteredProducts.map((product) => (
                <article className="product-card" key={product.id}>
                  <div className="product-image-wrap">
                    <img src={product.image_url || productPlaceholder} alt={product.name} />
                    <span className="stock-pill">{product.stock} left</span>
                  </div>

                  <div className="product-body">
                    <div className="product-meta-row">
                      <span className="category-badge">{product.category.replaceAll('_', ' ')}</span>
                      <strong className="price">{money(product.price)}</strong>
                    </div>

                    <h3>{product.name}</h3>
                    <p>{product.description}</p>

                    <button type="button" className="primary-button full-width" onClick={() => addToCart(product)}>
                      Add to cart
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>

          {cartOpen && (
            <aside className="cart-panel">
              <div className="cart-header">
                <h2>Your cart</h2>
                <button type="button" className="ghost-button" onClick={() => setCartOpen(false)}>
                  Close
                </button>
              </div>

              {cart.length === 0 ? (
                <div className="empty-cart">No items in cart.</div>
              ) : (
                <div className="cart-items">
                  {cart.map((item) => (
                    <div className="cart-item" key={item.productId}>
                      <div>
                        <strong>{item.name}</strong>
                        <span>{money(item.price)} each</span>
                      </div>
                      <div className="cart-item-actions">
                        <small>Qty: {item.quantity}</small>
                        <strong>{money(item.price * item.quantity)}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="totals-box">
                <div>
                  <span>Total</span>
                  <strong>{money(total)}</strong>
                </div>
              </div>

              <div className="checkout-form">
                <input placeholder="Your name" value={name} onChange={(event) => setName(event.target.value)} />
                <input placeholder="Phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
                <select value={payment} onChange={(event) => setPayment(event.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="mvola">Mvola</option>
                  <option value="card">Card</option>
                </select>
                <button type="button" className="primary-button full-width" onClick={placeOrder}>
                  Place order
                </button>
              </div>
            </aside>
          )}
        </section>
      </main>

      {adminOpen && (
        <div className="modal-backdrop">
          <form className="panel admin-signin" onSubmit={loginAdmin}>
            <button type="button" className="ghost-button close-inline" onClick={() => setAdminOpen(false)}>
              Close
            </button>
            <h2>Admin access</h2>
            <input
              type="email"
              value={credentials.email}
              onChange={(event) => setCredentials((current) => ({ ...current, email: event.target.value }))}
            />
            <input
              type="password"
              value={credentials.password}
              onChange={(event) => setCredentials((current) => ({ ...current, password: event.target.value }))}
            />
            <button type="submit" className="primary-button">
              Open dashboard
            </button>
          </form>
        </div>
      )}

      {receipt && (
        <section className="receipt-panel panel">
          <div className="receipt-box">
            <div className="receipt-header">
              <div>
                <span className="receipt-order">{receipt.order_code}</span>
                <h3>Receipt</h3>
              </div>
              <strong>{receipt.status}</strong>
            </div>

            <div className="receipt-meta">
              <p>
                <span>Customer</span>
                <strong>{receipt.customer_name}</strong>
              </p>
              <p>
                <span>Phone</span>
                <strong>{receipt.customer_phone}</strong>
              </p>
            </div>

            <div className="receipt-items">
              {receipt.items.map((item) => (
                <div className="receipt-item" key={`${receipt.id}-${item.productId}`}>
                  <span>
                    {item.name} × {item.quantity}
                  </span>
                  <strong>{money(item.price * item.quantity)}</strong>
                </div>
              ))}
            </div>

            <div className="receipt-total">
              <span>Total</span>
              <strong>{money(receipt.total)}</strong>
            </div>

            <div className="receipt-actions">
              <button type="button" className="primary-button" onClick={() => setReceipt(null)}>
                Continue shopping
              </button>
            </div>
          </div>
        </section>
      )}

      {toast && <div className="toast info">{toast}</div>}
    </div>
  )
}

export default App
