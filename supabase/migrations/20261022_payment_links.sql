-- One unguessable link per invoice that the customer opens to choose HOW to pay (card/bank via
-- Stripe, or Zelle). Only the SHA-256 hash of the token is stored. The amount is NOT frozen here:
-- the public pay-invoice function recomputes it from the live invoice each time, so an edit to the
-- invoice is always reflected. RLS is on with no policies: only the service-role functions touch it.
create table if not exists public.payment_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  repair_order_id uuid not null references public.repair_orders(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '60 days')
);
create index if not exists payment_links_repair_order_idx on public.payment_links (repair_order_id);
alter table public.payment_links enable row level security;
