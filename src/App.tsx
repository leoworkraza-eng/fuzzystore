import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RealtimeChannel, Session } from '@supabase/supabase-js'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import './App.css'
import './product-images.css'
import { productArt } from './productArt'
import PrinterReceipt from './PrinterReceipt'
import { useQrScanner } from './useQrScanner'
import { money } from './types'
import type { CartItem, Category, Order, Product } from './types'

/* ============================================================
   Supabase client
   ============================================================ */

const getSupabase = (): SupabaseClient | null => {
  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey || !url.startsWith('https://')) return null
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  })
}

const supabase = getSupabase()

/* ============================================================
   Constants & helpers
   ============================================================ */

const categories: Array<{ key: Category; label: string }> = [
  { key: 'all', label: 'All products' },
  { key: 'candies', label: 'Candies' },
  { key: 'snacks', label: 'Snacks' },
  { key: 'fresh_drinks', label: 'Fresh drinks' },
  { key: 'energy_drinks', label: 'Energy drinks' },
  { key: 'protein_snacks', label: 'Protein snacks' },
  { key: 'alcohol_cocktails', label: 'Alcohol & cocktails' },
]

const productCategories = categories.filter((c) => c.key !== 'all')

/* Demo catalogue used only when Supabase is not configured,
   so the UI can still be explored end to end. */
const demoProducts: Product[] = [
  { id: 'demo-monster', name: 'Monster Energy', price: 14000, stock: 12, available: true, category: 'energy_drinks', image_url: '', description: 'Classic energy boost with bold flavor and intense kick.' },
  { id: 'demo-gatorade', name: 'Gatorade Citrus', price: 20000, stock: 6, available: true, category: 'energy_drinks', image_url: '', description: 'Imported performance drink with a bright citrus finish.' },
  { id: 'demo-komvida', name: 'Kom Vida', price: 18000, stock: 4, available: true, category: 'fresh_drinks', image_url: '', description: 'Imported specialty juice with a clean, bright profile.' },
  { id: 'demo-haribo', name: 'Haribo Goldbears', price: 9000, stock: 20, available: true, category: 'candies', image_url: '', description: 'The classic gold bears — chewy, fruity, addictive.' },
  { id: 'demo-pringles', name: 'Pringles Original', price: 16000, stock: 8, available: true, category: 'snacks', image_url: '', description: 'Impossibly crisp, stackable potato crisps.' },
  { id: 'demo-nutella', name: 'Nutella B-ready', price: 12000, stock: 2, available: true, category: 'protein_snacks', image_url: '', description: 'Crispy wafer pockets filled with hazelnut spread.' },
]

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

const readCart = (): CartItem[] => {
  try {
    const raw = localStorage.getItem('fuzzy-cart')
    return raw ? (JSON.parse(raw) as CartItem[]) : []
  } catch {
    return []
  }
}

type AdminTab = 'orders' | 'scan' | 'stock' | 'new'

/* ============================================================
   App
   ============================================================ */

function App() {
  const [view, setView] = useState<'shop' | 'admin'>('shop')
  const [session, setSession] = useState<Session | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)

  const [products, setProducts] = useState<Product[]>(supabase ? [] : demoProducts)
  const [orders, setOrders] = useState<Order[]>([])
  const [dbError, setDbError] = useState<string | null>(
    supabase
      ? null
      : 'Supabase is not configured (missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) — running in demo mode.',
  )

  const [category, setCategory] = useState<Category>('all')
  const [cart, setCart] = useState<CartItem[]>(readCart)
  const [cartOpen, setCartOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [payment, setPayment] = useState('cash')
  const [placing, setPlacing] = useState(false)

  const [receipt, setReceipt] = useState<Order | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [credentials, setCredentials] = useState({ email: '', password: '' })

  const showToast = useCallback((message: string) => setToast(message), [])

  useEffect(() => {
    localStorage.setItem('fuzzy-cart', JSON.stringify(cart))
  }, [cart])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(timer)
  }, [toast])

  /* ---------- auth ---------- */

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      if (!newSession) {
        setIsAdmin(false)
        setView('shop')
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // Confirm admin flag once signed in.
  // ensure_profile() self-heals: if the user was created before the profiles
  // trigger existed (or the repair migration wasn't run), the row is created
  // here on the spot instead of login failing forever.
  useEffect(() => {
    if (!supabase || !session) return
    ;(async () => {
      const { data: ensured, error: ensureError } = await supabase.rpc('ensure_profile')
      if (ensureError || !ensured) {
        setDbError(
          `Could not load your profile: ${ensureError?.message ?? 'no row returned'}. ` +
            'The login repair migration (202609260001_login_repair.sql) probably has not been run yet.',
        )
        return
      }
      const row = Array.isArray(ensured) ? ensured[0] : ensured
      if (row.is_admin) setIsAdmin(true)
    })()
  }, [session])

  const loginAdmin = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!supabase) {
      // Demo mode: no database to protect — open the dashboard with demo data.
      setIsAdmin(true)
      setView('admin')
      setLoginOpen(false)
      showToast('Demo mode: dashboard opened without database connection.')
      return
    }
    if (!credentials.email.trim() || !credentials.password) {
      showToast('Enter your admin email and password.')
      return
    }
    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email: credentials.email.trim(),
      password: credentials.password,
    })
    if (error) {
      const msg =
        error.message === 'Invalid login credentials'
          ? 'Wrong email or password — or the user does not exist yet (create it in Supabase → Authentication → Users).'
          : error.message === 'Email not confirmed'
            ? 'This email is not confirmed. In Supabase → Authentication → Users, confirm the user (or recreate it with “Auto Confirm User” on).'
            : `Login failed: ${error.message}`
      showToast(msg)
      return
    }
    // Self-heal + read the admin flag
    const { data: ensured, error: ensureError } = await supabase.rpc('ensure_profile')
    const row = ensured && !Array.isArray(ensured) ? ensured : Array.isArray(ensured) ? ensured[0] : null
    if (ensureError || !row) {
      await supabase.auth.signOut()
      showToast(
        `Could not load your profile (${ensureError?.message ?? 'missing'}). ` +
          'Run the repair migration 202609260001_login_repair.sql in the Supabase SQL Editor.',
      )
      return
    }
    if (!row.is_admin) {
      await supabase.auth.signOut()
      showToast(
        `Signed in as ${authData.user?.email ?? 'user'}, but this account is not an admin. ` +
          'In the Supabase SQL Editor run: update public.profiles set is_admin = true where id = auth.uid(); while signed in — or ask me to flip it for your email.',
      )
      return
    }
    setIsAdmin(true)
    setView('admin')
    setLoginOpen(false)
    setCredentials({ email: '', password: '' })
    showToast('Admin access granted.')
  }

  const logoutAdmin = async () => {
    await supabase?.auth.signOut()
    setIsAdmin(false)
    setView('shop')
    showToast('Logged out.')
  }

  /* ---------- realtime data ---------- */

  const fetchProducts = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase.from('products').select('*')
    if (error) {
      setDbError(`Could not load products: ${error.message}`)
      return
    }
    setDbError(null)
    setProducts((data ?? []).map(normalizeProduct))
  }, [])

  const fetchOrders = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    if (!error) setOrders(data as Order[])
  }, [])

  useEffect(() => {
    fetchProducts()
  }, [fetchProducts])

  useEffect(() => {
    if (!supabase) return
    const channel: RealtimeChannel = supabase
      .channel('fuzzy-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => fetchProducts())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => fetchOrders())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [fetchProducts, fetchOrders])

  useEffect(() => {
    if (view === 'admin' && supabase) fetchOrders()
  }, [view, fetchOrders])

  /* ---------- storefront ---------- */

  const filteredProducts = useMemo(
    () =>
      (category === 'all' ? products : products.filter((p) => p.category === category)).filter(
        (p) => p.available !== false,
      ),
    [category, products],
  )

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)

  const stockOf = (productId: string) => products.find((p) => p.id === productId)?.stock ?? 0

  const addToCart = (product: Product) => {
    setCart((current) => {
      const existing = current.find((item) => item.productId === product.id)
      const inCart = existing?.quantity ?? 0
      if (inCart >= product.stock) {
        showToast(`Only ${product.stock} left of ${product.name}.`)
        return current
      }
      if (existing) {
        return current.map((item) =>
          item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item,
        )
      }
      return [...current, { productId: product.id, name: product.name, price: product.price, quantity: 1 }]
    })
  }

  const changeQty = (productId: string, delta: number) => {
    setCart((current) =>
      current
        .map((item) => {
          if (item.productId !== productId) return item
          const next = item.quantity + delta
          if (next <= 0) return null
          return { ...item, quantity: Math.min(next, stockOf(productId)) }
        })
        .filter((item): item is CartItem => item !== null),
    )
  }

  /* Atomic order: the RPC decrements stock in the same transaction,
     so the site can never oversell — screen stock == DB stock. */
  const placeOrder = async () => {
    if (!name.trim() || name.trim().length > 80) {
      showToast('Enter your name (max 80 characters).')
      return
    }
    if (!/^\+?[\d\s-]{6,20}$/.test(phone.trim())) {
      showToast('Enter a valid phone number (6–20 digits).')
      return
    }
    if (cart.length === 0) {
      showToast('Add a product and enter your details before placing an order.')
      return
    }
    // Final stock re-check against live data — protects against stale carts.
    const stale = cart.find((item) => item.quantity > stockOf(item.productId))
    if (stale) {
      showToast(`Only ${stockOf(stale.productId)} left of ${stale.name} — adjust your cart.`)
      return
    }
    if (supabase && placing) return
    setPlacing(true)

    try {
      if (supabase) {
        const { data, error } = await supabase.rpc('place_order', {
          p_customer_name: name.trim(),
          p_customer_phone: phone.trim(),
          p_payment_method: payment,
          p_items: cart,
        })
        if (error) {
          showToast(`Order failed: ${error.message}`)
          return
        }
        const order = Array.isArray(data) ? data[0] : (data as unknown as Order)
        setReceipt(order)
        await fetchProducts()
      } else {
        // Demo mode
        const order: Order = {
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
        setReceipt(order)
        setOrders((current) => [order, ...current])
      }
      setCart([])
      setName('')
      setPhone('')
      setPayment('cash')
      setCartOpen(false)
      showToast('Order placed — here is your receipt!')
    } finally {
      setPlacing(false)
    }
  }

  /* ---------- admin actions ---------- */

  // Cancelling restocks automatically via the DB trigger.
  // Validating is a two-step UI flow (confirm dialog) that DELETES the order
  // — stock was already decremented atomically when the order was placed.
  const cancelOrder = async (id: string) => {
    if (!supabase) {
      setOrders((current) => current.filter((o) => o.id !== id))
      showToast('Demo mode: order removed locally.')
      return
    }
    const { error } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', id)
    if (error) {
      showToast(`Could not cancel: ${error.message}`)
      return
    }
    await supabase.from('orders').delete().eq('id', id)
    await Promise.all([fetchOrders(), fetchProducts()])
    showToast('Order cancelled — stock restored, order removed.')
  }

  const validateOrder = async (id: string) => {
    const order = orders.find((o) => o.id === id)
    if (!order) return

    if (supabase) {
      // Safety net: force stock to match the order (guards against any drift,
      // e.g. stock was edited by hand between placement and pickup).
      for (const item of order.items) {
        const product = products.find((p) => p.id === item.productId)
        if (product) {
          const corrected = Math.max(0, product.stock - item.quantity)
          await supabase
            .from('products')
            .update({ stock: corrected, available: corrected > 0 })
            .eq('id', product.id)
        }
      }
      const { error } = await supabase.from('orders').delete().eq('id', id)
      if (error) {
        showToast(`Could not validate: ${error.message}`)
        return
      }
      await Promise.all([fetchOrders(), fetchProducts()])
    } else {
      setOrders((current) => current.filter((o) => o.id !== id))
      setProducts((current) =>
        current.map((p) => {
          const item = order.items.find((i) => i.productId === p.id)
          return item ? { ...p, stock: Math.max(0, p.stock - item.quantity), available: p.stock - item.quantity > 0 } : p
        }),
      )
    }
    setConfirmValidate(null)
    showToast(`Order ${order.order_code} validated — picked up, stock updated. 🎉`)
  }

  const validateByCode = async (rawCode: string) => {
    const code = rawCode.replace(/^FUZZY-ORDER:/i, '').trim().toUpperCase()
    if (!code) return
    const order = orders.find((o) => o.order_code.toUpperCase() === code)
    if (!order) {
      showToast(`No order found with code ${code}.`)
      return
    }
    if (order.status === 'cancelled') {
      showToast(`${code} was cancelled — cannot validate.`)
      return
    }
    setConfirmValidate(order)
  }

  const [confirmValidate, setConfirmValidate] = useState<Order | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<Order | null>(null)

  const updateStock = async (product: Product, stock: number) => {
    if (!Number.isFinite(stock) || stock < 0) {
      showToast('Stock must be a number of 0 or more.')
      return
    }
    if (!supabase) {
      setProducts((current) =>
        current.map((p) => (p.id === product.id ? { ...p, stock, available: stock > 0 } : p)),
      )
      showToast('Demo mode: stock changed locally only.')
      return
    }
    const { error } = await supabase
      .from('products')
      .update({ stock, available: stock > 0 })
      .eq('id', product.id)
    if (error) {
      showToast(`Stock update failed: ${error.message}`)
      return
    }
    await fetchProducts()
    showToast(`${product.name}: stock set to ${stock}.`)
  }

  const [newProduct, setNewProduct] = useState({
    name: '',
    price: '',
    stock: '',
    category: 'snacks',
    description: '',
    image_url: '',
  })

  const createProduct = async (event: React.FormEvent) => {
    event.preventDefault()
    // Validation — the product must match the database structure exactly.
    const name = newProduct.name.trim()
    const price = Number(newProduct.price)
    const stock = Math.floor(Number(newProduct.stock) || 0)
    const description = newProduct.description.trim() || 'Imported specialty product.'
    const imageUrl = newProduct.image_url.trim()

    if (name.length < 2 || name.length > 80) {
      showToast('Name must be between 2 and 80 characters.')
      return
    }
    if (!Number.isFinite(price) || price <= 0) {
      showToast('Price must be a positive number (in Ar).')
      return
    }
    if (stock < 0) {
      showToast('Stock cannot be negative.')
      return
    }
    if (!productCategories.some((c) => c.key === newProduct.category)) {
      showToast('Pick a valid category from the list.')
      return
    }
    if (imageUrl && !/^https:\/\//.test(imageUrl)) {
      showToast('Image URL must start with https://')
      return
    }
    if (!supabase) {
      showToast('Demo mode: connect Supabase to create products.')
      return
    }
    const { error } = await supabase.from('products').insert([
      {
        name,
        price,
        stock,
        available: stock > 0,
        category: newProduct.category,
        description: description.slice(0, 300),
        image_url: imageUrl || null,
      },
    ])
    if (error) {
      showToast(`Could not create product: ${error.message}`)
      return
    }
    setNewProduct({ name: '', price: '', stock: '', category: 'snacks', description: '', image_url: '' })
    await fetchProducts()
    showToast(`“${name}” is now live in the store ✓`)
  }

  /* ============================================================
     ADMIN VIEW
     ============================================================ */

  if (view === 'admin') {
    return (
      <AdminDashboard
        isAdmin={isAdmin}
        session={session}
        logoutAdmin={logoutAdmin}
        orders={orders}
        products={products}
        onCancelOrder={cancelOrder}
        onValidateOrder={validateOrder}
        validateByCode={validateByCode}
        updateStock={updateStock}
        newProduct={newProduct}
        setNewProduct={setNewProduct}
        createProduct={createProduct}
        confirmValidate={confirmValidate}
        setConfirmValidate={setConfirmValidate}
        confirmCancel={confirmCancel}
        setConfirmCancel={setConfirmCancel}
      />
    )
  }

  /* ============================================================
     SHOP VIEW
     ============================================================ */

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <img className="brand-logo" src="/logo.svg" alt="Fuzzy Store logo" onError={(e) => { e.currentTarget.style.display = 'none' }} />
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
          <button
            type="button"
            className="secondary-button"
            onClick={() => (isAdmin ? setView('admin') : setLoginOpen(true))}
          >
            Admin
          </button>
          <button type="button" className="cart-button" onClick={() => setCartOpen(true)}>
            Cart ({cart.reduce((sum, item) => sum + item.quantity, 0)})
          </button>
        </div>
      </header>

      <main className="page-shell">
        {dbError && (
          <div className="db-warning" role="alert">
            ⚠️ {dbError}
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
                onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })}
              >
                Explore collection
              </button>
            </div>
          </div>
          <div className="hero-card">
            <div className="hero-card-label">Best seller</div>
            <img src={productArt('Kom Vida', 'fresh_drinks')} alt="Kom Vida" />
            <div className="hero-card-product">Kom Vida</div>
            <div className="hero-card-price">18 000 Ar</div>
          </div>
        </section>

        <section id="products" className="content-grid">
          <div className="product-panel">
            <div className="section-header">
              <h2>Products</h2>
              <span>{filteredProducts.length} items · live stock</span>
            </div>

            <div className="product-grid">
              {filteredProducts.map((product) => (
                <article className="product-card" key={product.id}>
                  <div className="product-image-wrap">
                    <img
                      src={product.image_url || productArt(product.name, product.category)}
                      alt={product.name}
                      loading="lazy"
                    />
                    <span className={`stock-pill ${product.stock <= 3 ? 'low' : ''}`}>
                      {product.stock > 0 ? `${product.stock} left` : 'sold out'}
                    </span>
                  </div>

                  <div className="product-body">
                    <div className="product-meta-row">
                      <span className="category-badge">{product.category.replaceAll('_', ' ')}</span>
                      <strong className="price">{money(product.price)}</strong>
                    </div>

                    <h3>{product.name}</h3>
                    <p>{product.description}</p>

                    <button
                      type="button"
                      className="primary-button full-width"
                      disabled={product.stock <= 0}
                      onClick={() => addToCart(product)}
                    >
                      {product.stock > 0 ? 'Add to cart' : 'Sold out'}
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
                        <button type="button" className="qty-button" onClick={() => changeQty(item.productId, -1)} aria-label="Decrease">
                          −
                        </button>
                        <small>{item.quantity}</small>
                        <button
                          type="button"
                          className="qty-button"
                          onClick={() => changeQty(item.productId, 1)}
                          disabled={item.quantity >= stockOf(item.productId)}
                          aria-label="Increase"
                        >
                          +
                        </button>
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
                <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
                <input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <select value={payment} onChange={(e) => setPayment(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="mvola">Mvola</option>
                  <option value="card">Card</option>
                </select>
                <button type="button" className="primary-button full-width" disabled={placing} onClick={placeOrder}>
                  {placing ? 'Placing order…' : 'Place order'}
                </button>
              </div>
            </aside>
          )}
        </section>
      </main>

      {loginOpen && (
        <div className="modal-backdrop">
          <form className="panel admin-signin" onSubmit={loginAdmin}>
            <button type="button" className="ghost-button close-inline" onClick={() => setLoginOpen(false)}>
              Close
            </button>
            <h2>Admin access</h2>
            <input
              type="email"
              placeholder="admin email"
              value={credentials.email}
              onChange={(e) => setCredentials((c) => ({ ...c, email: e.target.value }))}
            />
            <input
              type="password"
              placeholder="password"
              value={credentials.password}
              onChange={(e) => setCredentials((c) => ({ ...c, password: e.target.value }))}
            />
            <button type="submit" className="primary-button">
              Open dashboard
            </button>
          </form>
        </div>
      )}

      {receipt && <PrinterReceipt order={receipt} onClose={() => setReceipt(null)} />}

      {toast && <div className="toast info">{toast}</div>}
    </div>
  )
}

/* ============================================================
   Admin dashboard (separate view)
   ============================================================ */

function AdminDashboard(props: {
  isAdmin: boolean
  session: Session | null
  logoutAdmin: () => void
  orders: Order[]
  products: Product[]
  onCancelOrder: (id: string) => void
  onValidateOrder: (id: string) => void
  validateByCode: (code: string) => void
  updateStock: (product: Product, stock: number) => void
  newProduct: { name: string; price: string; stock: string; category: string; description: string; image_url: string }
  setNewProduct: React.Dispatch<
    React.SetStateAction<{ name: string; price: string; stock: string; category: string; description: string; image_url: string }>
  >
  createProduct: (event: React.FormEvent) => void
  confirmValidate: Order | null
  setConfirmValidate: (order: Order | null) => void
  confirmCancel: Order | null
  setConfirmCancel: (order: Order | null) => void
}) {
  const {
    isAdmin,
    session,
    logoutAdmin,
    orders,
    products,
    onCancelOrder,
    onValidateOrder,
    validateByCode,
    updateStock,
    newProduct,
    setNewProduct,
    createProduct,
    confirmValidate,
    setConfirmValidate,
    confirmCancel,
    setConfirmCancel,
  } = props

  const [tab, setTab] = useState<AdminTab>('orders')
  const [manualCode, setManualCode] = useState('')
  const [stockDrafts, setStockDrafts] = useState<Record<string, string>>({})

  const pendingCount = orders.filter((o) => o.status === 'pending').length
  const lowStockCount = products.filter((p) => p.stock > 0 && p.stock <= 3).length
  const outOfStockCount = products.filter((p) => p.stock === 0).length
  const potentialRevenue = orders.reduce((sum, o) => sum + Number(o.total ?? 0), 0)

  const stats = [
    { label: 'Orders to pick up', value: String(pendingCount), tone: pendingCount ? 'warn' : 'ok' },
    { label: 'Potential revenue', value: money(potentialRevenue), tone: 'ok' },
    { label: 'Low stock (≤3)', value: String(lowStockCount), tone: lowStockCount ? 'warn' : 'ok' },
    { label: 'Sold out', value: String(outOfStockCount), tone: outOfStockCount ? 'bad' : 'ok' },
  ]

  // QR scanner — only mounted while the scan tab is active
  const ScanTab = () => {
    const scanner = useQrScanner((text) => validateByCode(text))
    return (
      <section className="admin-scan">
        <div className="section-header">
          <h2>Scan a receipt QR</h2>
          <span>validates against the database</span>
        </div>
        <div className="scan-layout">
          <div className="scan-video-wrap">
            <video ref={scanner.videoRef} muted playsInline />
            {scanner.status !== 'scanning' && (
              <div className="scan-overlay">
                {scanner.status === 'unsupported' && <p>This browser has no camera QR support. Use manual lookup →</p>}
                {scanner.status === 'denied' && <p>Camera permission denied. Enable it in your browser settings.</p>}
                {scanner.status === 'error' && <p>Camera error: {scanner.lastError}</p>}
                {(scanner.status === 'idle' || scanner.status === 'starting') && (
                  <button type="button" className="primary-button" onClick={scanner.start}>
                    {scanner.status === 'starting' ? 'Starting camera…' : 'Start camera'}
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="scan-side">
            <p className="scan-hint">Point the camera at the QR code printed on the customer's receipt. A match is validated instantly.</p>
            <div className="manual-lookup">
              <input
                type="text"
                placeholder="or type a code, e.g. FU-ABC123"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value.toUpperCase())}
              />
              <button type="button" className="primary-button" onClick={() => validateByCode(manualCode)}>
                Validate
              </button>
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div className="brand-block">
          <img className="brand-logo" src="/logo.svg" alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          <div>
            <small>FUZZY STORE / ADMIN</small>
            <h1>Dashboard</h1>
          </div>
        </div>
        <div className="admin-header-actions">
          <span className="admin-identity">{session?.user.email ?? 'demo mode'}</span>
          <button type="button" className="ghost-button" onClick={logoutAdmin}>
            Log out
          </button>
        </div>
      </header>

      <nav className="admin-tabs" aria-label="Admin sections">
        {(
          [
            ['orders', `Orders${pendingCount ? ` (${pendingCount})` : ''}`],
            ['scan', 'Scan QR'],
            ['stock', 'Stock'],
            ['new', 'New product'],
          ] as Array<[AdminTab, string]>
        ).map(([key, label]) => (
          <button
            type="button"
            key={key}
            className={tab === key ? 'admin-tab active' : 'admin-tab'}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="admin-content">
        {!isAdmin && (
          <div className="db-warning" role="alert">
            ⚠️ Signed in without admin rights — changes may be blocked by the database.
          </div>
        )}

        <div className="admin-stats">
          {stats.map((stat) => (
            <div className={`stat-card ${stat.tone}`} key={stat.label}>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>

        {tab === 'orders' && (
          <section className="admin-orders">
            <div className="section-header">
              <h2>Orders</h2>
              <span>{orders.length} recent · live</span>
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

                  <ul className="order-items">
                    {order.items.map((item) => (
                      <li key={`${order.id}-${item.productId}`}>
                        {item.name} × {item.quantity} — {money(item.price * item.quantity)}
                      </li>
                    ))}
                  </ul>

                  <div className="order-card-body">
                    <p>
                      <strong>{money(order.total)}</strong>
                    </p>
                    <p>
                      {order.payment_method} · {new Date(order.created_at).toLocaleString()}
                    </p>
                  </div>

                  <div className="order-actions">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => setConfirmValidate(order)}
                    >
                      ✓ Validate pickup
                    </button>
                    <button
                      type="button"
                      className="ghost-button danger"
                      onClick={() => setConfirmCancel(order)}
                    >
                      Cancel (restocks)
                    </button>
                  </div>
                </article>
              ))
            )}
          </section>
        )}

        {tab === 'scan' && <ScanTab />}

        {tab === 'stock' && (
          <section className="admin-stock">
            <div className="section-header">
              <h2>Stock</h2>
              <span>{products.length} products · realtime sync</span>
            </div>
            {products.length === 0 ? (
              <p className="empty-state">No products in the database yet — create one below.</p>
            ) : (
              <table className="stock-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Price</th>
                    <th>Stock</th>
                    <th>Set stock</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id} className={product.stock === 0 ? 'out' : ''}>
                      <td>{product.name}</td>
                      <td>{product.category.replaceAll('_', ' ')}</td>
                      <td>{money(product.price)}</td>
                      <td>
                        <span className={`stock-pill ${product.stock <= 3 ? 'low' : ''}`}>
                          {product.stock}
                        </span>
                      </td>
                      <td>
                        <div className="stock-edit">
                          <input
                            type="number"
                            min={0}
                            placeholder={String(product.stock)}
                            value={stockDrafts[product.id] ?? ''}
                            onChange={(e) => setStockDrafts((d) => ({ ...d, [product.id]: e.target.value }))}
                          />
                          <button
                            type="button"
                            className="primary-button small"
                            onClick={() => {
                              const raw = stockDrafts[product.id]
                              if (raw === undefined || raw === '') return
                              updateStock(product, Math.max(0, Number(raw)))
                              setStockDrafts((d) => {
                                const next = { ...d }
                                delete next[product.id]
                                return next
                              })
                            }}
                          >
                            Save
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {tab === 'new' && (
          <section className="admin-new">
            <div className="section-header">
              <h2>New product</h2>
              <span>goes straight into the store</span>
            </div>
            <form className="panel new-product-form" onSubmit={createProduct}>
              <label>
                Name
                <input
                  type="text"
                  value={newProduct.name}
                  onChange={(e) => setNewProduct((p) => ({ ...p, name: e.target.value }))}
                  required
                />
              </label>
              <div className="form-row">
                <label>
                  Price (Ar)
                  <input
                    type="number"
                    min={0}
                    value={newProduct.price}
                    onChange={(e) => setNewProduct((p) => ({ ...p, price: e.target.value }))}
                    required
                  />
                </label>
                <label>
                  Initial stock
                  <input
                    type="number"
                    min={0}
                    value={newProduct.stock}
                    onChange={(e) => setNewProduct((p) => ({ ...p, stock: e.target.value }))}
                  />
                </label>
              </div>
              <label>
                Category
                <select
                  value={newProduct.category}
                  onChange={(e) => setNewProduct((p) => ({ ...p, category: e.target.value }))}
                >
                  {productCategories.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Description
                <textarea
                  rows={3}
                  value={newProduct.description}
                  onChange={(e) => setNewProduct((p) => ({ ...p, description: e.target.value }))}
                />
              </label>
              <label>
                Image URL <small>(optional — generated art is used otherwise)</small>
                <input
                  type="url"
                  value={newProduct.image_url}
                  onChange={(e) => setNewProduct((p) => ({ ...p, image_url: e.target.value }))}
                />
              </label>
              <button type="submit" className="primary-button">
                Create product
              </button>
            </form>
          </section>
        )}
      </main>

      {/* ---- Confirm validation dialog ---- */}
      {confirmValidate && (
        <div className="modal-backdrop">
          <div className="panel confirm-dialog">
            <h2>Validate this order?</h2>
            <p className="confirm-order-code">{confirmValidate.order_code}</p>
            <ul className="order-items">
              {confirmValidate.items.map((item) => (
                <li key={item.productId}>
                  {item.name} × {item.quantity} — {money(item.price * item.quantity)}
                </li>
              ))}
            </ul>
            <p className="confirm-total">
              Total: <strong>{money(confirmValidate.total)}</strong>
            </p>
            <p className="confirm-note">
              The customer has their receipt in hand. The order will be removed from the
              dashboard and the stock will be updated. This cannot be undone.
            </p>
            <div className="confirm-actions">
              <button type="button" className="primary-button" onClick={() => onValidateOrder(confirmValidate.id)}>
                Yes, order validated
              </button>
              <button type="button" className="ghost-button" onClick={() => setConfirmValidate(null)}>
                Go back
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Confirm cancel dialog ---- */}
      {confirmCancel && (
        <div className="modal-backdrop">
          <div className="panel confirm-dialog">
            <h2>Cancel this order?</h2>
            <p className="confirm-order-code">{confirmCancel.order_code}</p>
            <p className="confirm-note">
              Every item goes back into stock and the order disappears from the dashboard.
            </p>
            <div className="confirm-actions">
              <button type="button" className="ghost-button danger" onClick={() => onCancelOrder(confirmCancel.id)}>
                Yes, cancel it
              </button>
              <button type="button" className="primary-button" onClick={() => setConfirmCancel(null)}>
                Keep the order
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default App
