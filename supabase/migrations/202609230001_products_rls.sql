-- Fuzzy Store products RLS
-- Run this SQL in the Supabase SQL Editor for the project used by VITE_SUPABASE_URL.
-- Allows the public anon key to read the product catalog (needed by the storefront).

alter table public.products enable row level security;

grant select on table public.products to anon;

drop policy if exists "products_anon_select" on public.products;
create policy "products_anon_select"
on public.products
for select
to anon
using (true);

-- Verify the policies after running this script:
select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'products';
