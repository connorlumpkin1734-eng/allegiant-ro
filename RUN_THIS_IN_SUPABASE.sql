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

-- Private RO photos attached to customer-facing service jobs.
begin;
create table if not exists public.estimate_photos (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  repair_order_id uuid not null references public.repair_orders(id) on delete cascade, service_group_id uuid not null,
  storage_path text not null unique, caption text, sort_order integer not null default 0, created_at timestamptz not null default now()
);
create index if not exists estimate_photos_ro_idx on public.estimate_photos(repair_order_id);
create index if not exists estimate_photos_group_idx on public.estimate_photos(service_group_id);
alter table public.estimate_photos enable row level security;
drop policy if exists "Owners can view estimate photos" on public.estimate_photos;
create policy "Owners can view estimate photos" on public.estimate_photos for select using (auth.uid() = owner_id);
drop policy if exists "Owners can add estimate photos" on public.estimate_photos;
create policy "Owners can add estimate photos" on public.estimate_photos for insert with check (auth.uid() = owner_id);
drop policy if exists "Owners can update estimate photos" on public.estimate_photos;
create policy "Owners can update estimate photos" on public.estimate_photos for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "Owners can delete estimate photos" on public.estimate_photos;
create policy "Owners can delete estimate photos" on public.estimate_photos for delete using (auth.uid() = owner_id);
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('estimate-photos', 'estimate-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
drop policy if exists "Owners can view their estimate photo files" on storage.objects;
create policy "Owners can view their estimate photo files" on storage.objects for select using (bucket_id = 'estimate-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Owners can upload their estimate photo files" on storage.objects;
create policy "Owners can upload their estimate photo files" on storage.objects for insert with check (bucket_id = 'estimate-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Owners can delete their estimate photo files" on storage.objects;
create policy "Owners can delete their estimate photo files" on storage.objects for delete using (bucket_id = 'estimate-photos' and (storage.foldername(name))[1] = auth.uid()::text);
commit;

-- Customer estimate email approvals and signatures.
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
create policy "Owners can view estimate authorizations" on public.estimate_authorizations for select using (auth.uid() = owner_id);

commit;

-- Customer-facing service jobs group labor, associated parts, and technician stories.
begin;

alter table public.line_items
  add column if not exists service_group_id uuid;

alter table public.line_items
  add column if not exists service_group_title text;

alter table public.line_items
  add column if not exists technician_story text;

create index if not exists line_items_service_group_idx
  on public.line_items(repair_order_id, service_group_id);

commit;

-- Multipoint inspections saved and recalled with each repair order.
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
create policy "Owners can view multipoint inspections" on public.multipoint_inspections
  for select using (auth.uid() = owner_id);

drop policy if exists "Owners can create multipoint inspections" on public.multipoint_inspections;
create policy "Owners can create multipoint inspections" on public.multipoint_inspections
  for insert with check (
    auth.uid() = owner_id
    and exists (
      select 1 from public.repair_orders
      where repair_orders.id = multipoint_inspections.repair_order_id
        and repair_orders.owner_id = auth.uid()
    )
  );

drop policy if exists "Owners can update multipoint inspections" on public.multipoint_inspections;
create policy "Owners can update multipoint inspections" on public.multipoint_inspections
  for update using (auth.uid() = owner_id)
  with check (
    auth.uid() = owner_id
    and exists (
      select 1 from public.repair_orders
      where repair_orders.id = multipoint_inspections.repair_order_id
        and repair_orders.owner_id = auth.uid()
    )
  );

drop policy if exists "Owners can delete multipoint inspections" on public.multipoint_inspections;
create policy "Owners can delete multipoint inspections" on public.multipoint_inspections
  for delete using (auth.uid() = owner_id);

commit;
