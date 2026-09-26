-- Fuzzy Store — atomic ordering + admin auth
-- Run in the Supabase SQL Editor for the project used by VITE_SUPABASE_URL.
-- Idempotent: safe to re-run.

-- ============================================================
-- 1. Admin role via Supabase Auth
-- ============================================================
-- Admins are regular auth users whose profile row has is_admin = true.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Auto-create a profile on signup (admin flag set manually in the dashboard).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, is_admin)
  values (new.id, false)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Helper: is the current request an admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

-- ============================================================
-- 2. Atomic order placement (the stock source of truth)
-- ============================================================
-- place_order inserts the order AND decrements stock in ONE transaction.
-- It refuses items that are unavailable or out of stock, so the website
-- can never oversell: stock on screen is always stock in the DB.

create or replace function public.place_order(
  p_customer_name text,
  p_customer_phone text,
  p_payment_method text,
  p_items jsonb,           -- [{productId, name, price, quantity}]
  p_order_code text default null
)
returns public.orders
language plpgsql
security definer set search_path = public
as $$
declare
  v_order public.orders;
  v_item jsonb;
  v_qty int;
  v_new_stock int;
  v_total numeric(12, 2) := 0;
  v_product public.products;
  v_code text;
begin
  if p_customer_name is null or btrim(p_customer_name) = '' then
    raise exception 'customer name is required';
  end if;
  if p_customer_phone is null or btrim(p_customer_phone) = '' then
    raise exception 'customer phone is required';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'order must contain at least one item';
  end if;

  v_code := coalesce(p_order_code, 'FU-' || upper(substr(md5(random()::text), 1, 6)));

  insert into public.orders (order_code, customer_name, customer_phone, items, total, payment_method, status)
  values (v_code, btrim(p_customer_name), btrim(p_customer_phone), p_items, 0, p_payment_method, 'pending')
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := coalesce((v_item->>'quantity')::int, 0);
    if v_qty <= 0 then
      raise exception 'invalid quantity for item %', v_item->>'productId';
    end if;

    select * into v_product from public.products where id = (v_item->>'productId')::uuid
      for update;  -- row lock: two orders racing for the last unit resolve here

    if not found then
      raise exception 'unknown product %', v_item->>'productId';
    end if;
    if v_product.available = false then
      raise exception 'product % is unavailable', v_product.name;
    end if;
    if v_product.stock < v_qty then
      raise exception 'insufficient stock for % (requested %, left %)', v_product.name, v_qty, v_product.stock;
    end if;

    v_new_stock := v_product.stock - v_qty;

    update public.products
    set stock = v_new_stock,
        available = v_new_stock > 0
    where id = v_product.id;

    v_total := v_total + (v_product.price * v_qty);
  end loop;

  update public.orders set total = v_total where id = v_order.id returning * into v_order;

  return v_order;
end;
$$;

-- Anyone (anon) can place an order through the RPC.
grant execute on function public.place_order(text, text, text, jsonb, text) to anon, authenticated;

-- ============================================================
-- 3. Restock when an order is cancelled (keeps stock == live activity)
-- ============================================================
create or replace function public.handle_order_status_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_item jsonb;
  v_qty int;
begin
  -- Only act on the pending -> cancelled transition
  if new.status = 'cancelled' and old.status = 'pending' then
    for v_item in select * from jsonb_array_elements(new.items)
    loop
      v_qty := coalesce((v_item->>'quantity')::int, 0);
      if v_qty > 0 and v_item->>'productId' is not null then
        update public.products
        set stock = least(
              stock + v_qty,
              (select coalesce(max(p2.stock), 999999) from public.products p2 where p2.id = products.id)
            ),
            available = true
        where id = (v_item->>'productId')::uuid;
      end if;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists on_order_status_change on public.orders;
create trigger on_order_status_change
after update of status on public.orders
for each row execute function public.handle_order_status_change();

-- ============================================================
-- 4. RLS rework: anon reads + authenticated admin writes
-- ============================================================

-- PRODUCTS ---------------------------------------------------
alter table public.products enable row level security;

grant select on table public.products to anon, authenticated;
grant update (stock, available) on table public.products to authenticated;

drop policy if exists "products_anon_select" on public.products;
create policy "products_anon_select"
on public.products
for select
to anon, authenticated
using (true);

-- Direct stock edits are admin-only (the storefront goes through place_order).
drop policy if exists "products_admin_update" on public.products;
create policy "products_admin_update"
on public.products
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "products_admin_insert" on public.products;
create policy "products_admin_insert"
on public.products
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "products_admin_delete" on public.products;
create policy "products_admin_delete"
on public.products
for delete
to authenticated
using (public.is_admin());

-- ORDERS -----------------------------------------------------
alter table public.orders enable row level security;

grant select, insert on table public.orders to anon, authenticated;
grant update (status) on table public.orders to authenticated;

drop policy if exists "orders_anon_insert_pending" on public.orders;
drop policy if exists "Allow public order creation" on public.orders;
create policy "orders_anon_insert_pending"
on public.orders
for insert
to anon, authenticated
with check (
  customer_name is not null
  and btrim(customer_name) <> ''
  and customer_phone is not null
  and btrim(customer_phone) <> ''
  and total >= 0
  and status = 'pending'
);

drop policy if exists "orders_anon_select" on public.orders;
drop policy if exists "Allow public order reads" on public.orders;
create policy "orders_anon_select"
on public.orders
for select
to anon, authenticated
using (true);

drop policy if exists "orders_admin_update_status" on public.orders;
drop policy if exists "orders_anon_update_status" on public.orders;
drop policy if exists "Allow public order updates" on public.orders;
create policy "orders_admin_update_status"
on public.orders
for update
to authenticated
using (public.is_admin())
with check (status in ('pending', 'validated', 'cancelled'));

-- PROFILES: admins can grant/revoke other admins ----------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_self_read" on public.profiles;
create policy "profiles_self_read"
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update"
on public.profiles
for update
to authenticated
using (public.is_admin())
with check (true);

-- ============================================================
-- 5. Verify
-- ============================================================
select policyname, cmd, roles from pg_policies
where schemaname = 'public' and tablename in ('products', 'orders', 'profiles')
order by tablename, policyname;
