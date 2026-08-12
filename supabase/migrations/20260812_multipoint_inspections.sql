-- Persistent multipoint inspections linked one-to-one with repair orders.
-- Safe to run more than once.

begin;

create table if not exists public.multipoint_inspections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  repair_order_id uuid not null references public.repair_orders(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (repair_order_id)
);

create index if not exists multipoint_inspections_owner_idx
  on public.multipoint_inspections(owner_id);

alter table public.multipoint_inspections enable row level security;

drop policy if exists "Owners can view multipoint inspections" on public.multipoint_inspections;
create policy "Owners can view multipoint inspections"
  on public.multipoint_inspections for select
  using (auth.uid() = owner_id);

drop policy if exists "Owners can create multipoint inspections" on public.multipoint_inspections;
create policy "Owners can create multipoint inspections"
  on public.multipoint_inspections for insert
  with check (
    auth.uid() = owner_id
    and exists (
      select 1 from public.repair_orders
      where repair_orders.id = multipoint_inspections.repair_order_id
        and repair_orders.owner_id = auth.uid()
    )
  );

drop policy if exists "Owners can update multipoint inspections" on public.multipoint_inspections;
create policy "Owners can update multipoint inspections"
  on public.multipoint_inspections for update
  using (auth.uid() = owner_id)
  with check (
    auth.uid() = owner_id
    and exists (
      select 1 from public.repair_orders
      where repair_orders.id = multipoint_inspections.repair_order_id
        and repair_orders.owner_id = auth.uid()
    )
  );

drop policy if exists "Owners can delete multipoint inspections" on public.multipoint_inspections;
create policy "Owners can delete multipoint inspections"
  on public.multipoint_inspections for delete
  using (auth.uid() = owner_id);

commit;
