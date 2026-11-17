-- Tracks when a customer opens the estimate or invoice link we emailed them.
-- One row per RO per document. Kept off repair_orders on purpose: every update there bumps
-- edit_version, and a customer opening a link must never cause an advisor's edit conflict.
create table if not exists public.document_views (
  repair_order_id uuid not null references public.repair_orders(id) on delete cascade,
  kind text not null check (kind in ('estimate', 'invoice')),
  owner_id uuid not null,
  sent_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer not null default 0,
  primary key (repair_order_id, kind)
);

alter table public.document_views enable row level security;

create policy "Owners view document views" on public.document_views
  for select using (owner_id = (select auth.uid()));
create policy "Advisors and admins view document views" on public.document_views
  for select using (active_staff_role(owner_id) = 'service_advisor' or staff_is_admin(owner_id));

-- Only the server (service role) writes. A send resets the counters so "viewed" always means
-- the latest copy the customer was sent.
create or replace function public.record_document_sent(p_repair_order_id uuid, p_owner_id uuid, p_kind text)
returns void language sql security definer set search_path = public as $$
  insert into document_views (repair_order_id, kind, owner_id, sent_at, first_viewed_at, last_viewed_at, view_count)
  values (p_repair_order_id, p_kind, p_owner_id, now(), null, null, 0)
  on conflict (repair_order_id, kind) do update
    set sent_at = now(), first_viewed_at = null, last_viewed_at = null, view_count = 0;
$$;

create or replace function public.record_document_view(p_repair_order_id uuid, p_owner_id uuid, p_kind text)
returns void language sql security definer set search_path = public as $$
  insert into document_views (repair_order_id, kind, owner_id, first_viewed_at, last_viewed_at, view_count)
  values (p_repair_order_id, p_kind, p_owner_id, now(), now(), 1)
  on conflict (repair_order_id, kind) do update
    set first_viewed_at = coalesce(document_views.first_viewed_at, now()),
        last_viewed_at = now(),
        view_count = document_views.view_count + 1;
$$;

revoke all on function public.record_document_sent(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.record_document_view(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_document_sent(uuid, uuid, text) to service_role;
grant execute on function public.record_document_view(uuid, uuid, text) to service_role;

-- Customers never touch this table directly; staff only read it.
revoke all on public.document_views from anon;
revoke insert, update, delete, truncate, references, trigger on public.document_views from authenticated;
