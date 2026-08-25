-- RO and service-job photos stored privately in Supabase Storage.
-- Safe to run more than once.

begin;

create table if not exists public.estimate_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  repair_order_id uuid not null references public.repair_orders(id) on delete cascade,
  service_group_id uuid not null,
  storage_path text not null unique,
  caption text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
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
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Owners can view their estimate photo files" on storage.objects;
create policy "Owners can view their estimate photo files" on storage.objects for select
  using (bucket_id = 'estimate-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Owners can upload their estimate photo files" on storage.objects;
create policy "Owners can upload their estimate photo files" on storage.objects for insert
  with check (bucket_id = 'estimate-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Owners can delete their estimate photo files" on storage.objects;
create policy "Owners can delete their estimate photo files" on storage.objects for delete
  using (bucket_id = 'estimate-photos' and (storage.foldername(name))[1] = auth.uid()::text);

commit;
