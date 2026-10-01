-- Simple, privacy-light traffic counter for the god-mode Platform Admin screen: how many people are
-- landing on the login/signup page. visitor_id is a random id generated client-side and stored in
-- that browser's localStorage (never tied to a name, email, or account) so repeat visits from the
-- same browser can be told apart from new ones. Writes go through track-visit.ts (service role) so
-- this table is never directly writable by anonymous clients.

create table if not exists public.site_visits (
  id uuid primary key default gen_random_uuid(),
  visitor_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists site_visits_created_at_idx on public.site_visits (created_at);
create index if not exists site_visits_visitor_id_idx on public.site_visits (visitor_id);

alter table public.site_visits enable row level security;
-- No select/insert policies for anon/authenticated: this table is only ever touched by the
-- service role (track-visit.ts for writes, site_visit_stats() for the god-mode read).

-- Returns all-time totals plus a day-by-day breakdown for the last 90 days, in one call so the
-- Netlify function doesn't have to page through raw rows or risk a default-limit truncation.
create or replace function public.site_visit_stats()
returns table (
  total_visits bigint,
  unique_visitors bigint,
  daily jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.site_visits) as total_visits,
    (select count(distinct visitor_id) from public.site_visits) as unique_visitors,
    coalesce(
      (
        select jsonb_agg(day_row order by day_row->>'date' desc)
        from (
          select jsonb_build_object(
            'date', to_char(date_trunc('day', created_at), 'YYYY-MM-DD'),
            'visits', count(*),
            'uniqueVisitors', count(distinct visitor_id)
          ) as day_row
          from public.site_visits
          where created_at >= now() - interval '90 days'
          group by date_trunc('day', created_at)
        ) grouped
      ),
      '[]'::jsonb
    ) as daily;
$$;

revoke all on function public.site_visit_stats() from public, anon, authenticated;
grant execute on function public.site_visit_stats() to service_role;
