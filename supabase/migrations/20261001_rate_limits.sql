-- Shared fixed-window rate limiter for public, unauthenticated endpoints (pay-zelle,
-- estimate-approval). Netlify Functions are stateless/multi-instance, so the counter has to live
-- somewhere persistent and be incremented atomically — a single UPSERT under row-level locking
-- does that without needing a separate service (Redis, etc.).
create table if not exists public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null default 0
);

-- No RLS needed: this table holds no tenant data, and only ever gets touched through
-- check_rate_limit() below (SECURITY DEFINER), called with the service-role key from Netlify
-- functions — never exposed directly to anon/authenticated clients.
alter table public.rate_limits enable row level security;

create or replace function public.check_rate_limit(p_key text, p_window_seconds integer, p_max_requests integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  insert into public.rate_limits (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    count = case
      when public.rate_limits.window_start <= now() - make_interval(secs => p_window_seconds) then 1
      else public.rate_limits.count + 1
    end,
    window_start = case
      when public.rate_limits.window_start <= now() - make_interval(secs => p_window_seconds) then now()
      else public.rate_limits.window_start
    end
  returning count into v_count;

  return v_count <= p_max_requests;
end;
$$;

grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
