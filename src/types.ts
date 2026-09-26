export type Category =
  | 'all'
  | 'candies'
  | 'snacks'
  | 'fresh_drinks'
  | 'energy_drinks'
  | 'protein_snacks'
  | 'alcohol_cocktails'

export type Product = {
  id: string
  name: string
  price: number
  stock: number
  available: boolean
  category: string
  image_url?: string
  description: string
}

export type CartItem = {
  productId: string
  name: string
  price: number
  quantity: number
}

export type OrderStatus = 'pending' | 'validated' | 'cancelled'

export type Order = {
  id: string
  order_code: string
  customer_name: string
  customer_phone: string
  items: CartItem[]
  total: number
  payment_method: string
  status: OrderStatus
  created_at: string
}

export const money = (value: number) =>
  new Intl.NumberFormat('fr-MG', {
    style: 'currency',
    currency: 'MGA',
    maximumFractionDigits: 0,
  }).format(value)
