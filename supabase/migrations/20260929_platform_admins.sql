-- A platform-operator login is no longer tied to any shop's settings row.
-- Membership in this table is the only thing that grants access to the
-- cross-tenant Platform Admin screen and its backing function
-- (netlify/functions/platform-admin.ts) — no shop owner or shop staff
-- account, however privileged within their own shop, can ever reach it.
--
-- Rows here are added manually (not through the app) since this is meant to
-- be a small, deliberate list, not something shop owners can grant
-- themselves or each other.

create table if not exists public.platform_admins (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

drop policy if exists "Platform admins can see themselves" on public.platform_admins;
create policy "Platform admins can see themselves"
  on public.platform_admins for select
  using (auth.uid() = id);
