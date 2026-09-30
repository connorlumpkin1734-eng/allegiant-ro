-- Adds a plain "username" login field for staff (technicians/service advisors),
-- separate from their real email address. The real email stays on the account
-- for password-reset purposes only; day-to-day sign-in uses the username.
--
-- username_lower is a generated, always-in-sync lowercase copy used for
-- case-insensitive lookups and to enforce uniqueness without worrying about
-- SQL LIKE wildcard characters (which plain username text could contain).
--
-- Usernames are unique across the whole platform, not just within one shop,
-- because the login screen resolves a typed username to an email before it
-- knows which shop the person belongs to.

alter table public.staff add column if not exists username text;

alter table public.staff add column if not exists username_lower text
  generated always as (lower(username)) stored;

create unique index if not exists staff_username_lower_unique_idx
  on public.staff (username_lower)
  where username_lower is not null;
