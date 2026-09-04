begin;

create table if not exists public.quote_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'website',
  request_type text not null default 'quote' check (request_type in ('quote', 'second_opinion')),
  status text not null default 'new' check (status in ('new', 'reviewing', 'quoted', 'converted', 'closed')),
  name text not null,
  phone text,
  email text,
  preferred_contact text check (preferred_contact in ('phone', 'text', 'email')),
  vehicle_year integer,
  vehicle_make text,
  vehicle_model text,
  vin text not null,
  mileage integer,
  request_text text,
  converted_ro_id uuid references public.repair_orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_requests_contact_required check (coalesce(nullif(trim(phone), ''), nullif(trim(email), '')) is not null),
  constraint quote_requests_vin_format check (vin ~ '^[A-HJ-NPR-Z0-9]{17}$')
);

create table if not exists public.quote_request_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  quote_request_id uuid not null references public.quote_requests(id) on delete cascade,
  file_kind text not null default 'quote' check (file_kind in ('quote', 'vehicle_photo', 'vin_photo')),
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  file_size bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists quote_requests_owner_created_idx on public.quote_requests(owner_id, created_at desc);
create index if not exists quote_requests_owner_status_idx on public.quote_requests(owner_id, status);
create index if not exists quote_request_files_request_idx on public.quote_request_files(quote_request_id);

alter table public.quote_requests enable row level security;
alter table public.quote_request_files enable row level security;

drop policy if exists "Owners can view quote requests" on public.quote_requests;
create policy "Owners can view quote requests" on public.quote_requests for select using (auth.uid() = owner_id);

drop policy if exists "Owners can update quote requests" on public.quote_requests;
create policy "Owners can update quote requests" on public.quote_requests for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "Owners can delete quote requests" on public.quote_requests;
create policy "Owners can delete quote requests" on public.quote_requests for delete using (auth.uid() = owner_id);

drop policy if exists "Owners can view quote request files" on public.quote_request_files;
create policy "Owners can view quote request files" on public.quote_request_files for select using (auth.uid() = owner_id);

drop policy if exists "Owners can delete quote request files" on public.quote_request_files;
create policy "Owners can delete quote request files" on public.quote_request_files for delete using (auth.uid() = owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'quote-request-files',
  'quote-request-files',
  false,
  12582912,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 12582912,
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Owners can view their quote request files" on storage.objects;
create policy "Owners can view their quote request files" on storage.objects
  for select using (
    bucket_id = 'quote-request-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Owners can delete their quote request files" on storage.objects;
create policy "Owners can delete their quote request files" on storage.objects
  for delete using (
    bucket_id = 'quote-request-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;
