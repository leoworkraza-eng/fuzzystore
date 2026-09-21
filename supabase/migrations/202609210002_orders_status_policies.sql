-- Fuzzy Store orders RLS and API grants
-- Run this SQL in the Supabase SQL Editor for the project used by VITE_SUPABASE_URL.
-- Committing this file does not execute it automatically in an existing Supabase project.

alter table public.orders enable row level security;

grant select, insert, update on table public.orders to anon;

-- Remove older versions so the policy names/conditions cannot conflict.
drop policy if exists "Allow public order creation" on public.orders;
drop policy if exists "Allow public order reads" on public.orders;
drop policy if exists "Allow public order updates" on public.orders;
drop policy if exists "Allow demo admin order updates" on public.orders;
drop policy if exists "Allow public order confirmation" on public.orders;

create policy "orders_anon_insert_pending"
on public.orders
for insert
to anon
with check (
  customer_name is not null
  and btrim(customer_name) <> ''
  and customer_phone is not null
  and btrim(customer_phone) <> ''
  and total >= 0
  and status = 'pending'
);

create policy "orders_anon_select"
on public.orders
for select
to anon
using (true);

create policy "orders_anon_update_status"
on public.orders
for update
to anon
using (true)
with check (status in ('pending', 'validated', 'cancelled'));

-- Verify the policies after running this script:
select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'orders';
