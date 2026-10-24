-- Fix: staff were asked to change their password on every refresh.
-- The app cleared must_change_password with a direct update on public.staff, but staff have no
-- UPDATE policy on their own row (on purpose: they must not edit their own role/admin flag),
-- so the update silently changed nothing. This function lets a signed-in user clear only
-- their own flag, and nothing else.

create or replace function public.clear_my_password_change_flag()
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.staff
  set must_change_password = false
  where auth_user_id = auth.uid() and must_change_password;
$$;

revoke execute on function public.clear_my_password_change_flag() from public, anon;
grant execute on function public.clear_my_password_change_flag() to authenticated;
