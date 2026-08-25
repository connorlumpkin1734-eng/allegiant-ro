-- Customer estimate email, approval, decline, signature, and audit trail.
-- Safe to run more than once.

begin;

alter table public.repair_orders add column if not exists estimate_status text not null default 'not_sent';
alter table public.repair_orders add column if not exists estimate_sent_at timestamptz;
alter table public.repair_orders add column if not exists estimate_responded_at timestamptz;

create table if not exists public.estimate_authorizations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  repair_order_id uuid not null references public.repair_orders(id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'sent',
  customer_name text,
  customer_email text not null,
  estimate_snapshot jsonb not null,
  signature_data text,
  consent_accepted boolean not null default false,
  response_ip text,
  response_user_agent text,
  sent_at timestamptz not null default now(),
  responded_at timestamptz
);

create index if not exists estimate_authorizations_owner_idx on public.estimate_authorizations(owner_id);
create index if not exists estimate_authorizations_ro_idx on public.estimate_authorizations(repair_order_id);
alter table public.estimate_authorizations enable row level security;

drop policy if exists "Owners can view estimate authorizations" on public.estimate_authorizations;
create policy "Owners can view estimate authorizations" on public.estimate_authorizations
  for select using (auth.uid() = owner_id);

commit;
