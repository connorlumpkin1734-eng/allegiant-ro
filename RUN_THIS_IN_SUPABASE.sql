-- Allegiant RO: archive support for customers and repair orders
-- Safe to run once on the existing database.

begin;

alter table public.customers
  add column if not exists archived_at timestamptz;

alter table public.repair_orders
  add column if not exists archived_at timestamptz;

create index if not exists customers_owner_archived_idx
  on public.customers(owner_id, archived_at);

create index if not exists repair_orders_owner_archived_idx
  on public.repair_orders(owner_id, archived_at);

commit;
