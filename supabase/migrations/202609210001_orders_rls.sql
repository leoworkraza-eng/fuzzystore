-- Fuzzy Store order policies
-- Apply this migration in the Supabase SQL editor or through Supabase CLI.
-- The current frontend uses the public anon client for checkout and the demo
-- admin panel, so these policies match the current application architecture.

alter table public.orders enable row level security;

drop policy if exists "Allow public order creation" on public.orders;
create policy "Allow public order creation"
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

drop policy if exists "Allow public order reads" on public.orders;
create policy "Allow public order reads"
on public.orders
for select
to anon
using (true);

drop policy if exists "Allow demo admin order updates" on public.orders;
create policy "Allow demo admin order updates"
on public.orders
for update
to anon
using (true)
with check (status in ('pending', 'validated', 'cancelled'));
