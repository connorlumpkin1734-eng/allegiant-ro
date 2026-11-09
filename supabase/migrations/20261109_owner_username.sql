-- Owners can sign in with a username too (e.g. "allegiantauto"), not just their email.
-- Usernames are stored lowercase and are unique across owners AND staff, because the sign-in
-- screen has to know which single account a typed username belongs to.
alter table public.settings add column if not exists owner_username text;
alter table public.settings drop constraint if exists settings_owner_username_format;
alter table public.settings add constraint settings_owner_username_format
  check (owner_username is null or owner_username ~ '^[a-z0-9_]{3,20}$');
create unique index if not exists settings_owner_username_unique
  on public.settings (owner_username) where owner_username is not null;

create or replace function public.login_name_conflict() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'settings' then
    if new.owner_username is not null
       and exists (select 1 from public.staff where username_lower = new.owner_username) then
      raise exception 'That username is already taken.' using errcode = '23505';
    end if;
  else
    if new.username is not null
       and exists (select 1 from public.settings where owner_username = lower(new.username)) then
      raise exception 'That username is already taken.' using errcode = '23505';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.login_name_conflict() from public, anon, authenticated;

drop trigger if exists settings_owner_username_unique_across on public.settings;
create trigger settings_owner_username_unique_across
  before insert or update of owner_username on public.settings
  for each row execute function public.login_name_conflict();

drop trigger if exists staff_username_unique_across on public.staff;
create trigger staff_username_unique_across
  before insert or update of username on public.staff
  for each row execute function public.login_name_conflict();
