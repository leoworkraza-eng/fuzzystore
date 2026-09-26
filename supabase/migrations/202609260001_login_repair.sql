-- Fuzzy Store — login repair: guarantees every auth user has a profile row,
-- and self-heals on future sign-ins. Idempotent: safe to re-run.
--
-- WHY THIS EXISTS: if a user was created before the profiles trigger
-- existed, they have no profiles row and admin login fails with
-- "This account is not an admin". This migration backfills everyone.

-- ============================================================
-- 1. Make sure the profiles table + trigger exist
--    (in case 202609250001_atomic_orders_admin.sql was not run)
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ============================================================
-- 2. Backfill: one profile row per existing auth user
-- ============================================================

insert into public.profiles (id, is_admin)
select u.id, false
from auth.users u
on conflict (id) do nothing;

-- ============================================================
-- 3. Self-heal RPC: the app calls this right after sign-in.
--    If the signed-in user somehow has no profile row, it is
--    created on the spot. Safe to call repeatedly.
-- ============================================================

create or replace function public.ensure_profile()
returns public.profiles
language plpgsql
security definer set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  insert into public.profiles (id, is_admin)
  values (auth.uid(), false)
  on conflict (id) do update set id = excluded.id  -- no-op update so the RETURNING always fires
  returning * into v_profile;

  return v_profile;
end;
$$;

grant execute on function public.ensure_profile() to authenticated;

-- ============================================================
-- 4. Promote an admin by email — EDIT THE EMAIL, then run.
--    (This block is commented out; uncomment and run it once
--    in the Supabase SQL Editor after creating your user.)
-- ============================================================

-- update public.profiles
-- set is_admin = true
-- where id = (select id from auth.users where email = 'you@example.com');

-- ============================================================
-- 5. Verify
-- ============================================================
-- See every user and their admin flag:
-- select u.email, p.is_admin
-- from auth.users u left join public.profiles p on p.id = u.id;
