-- The redesign's theme toggle stores light / dark / system. Old values stay allowed so the current
-- app keeps working against the same database.
alter table public.user_preferences drop constraint if exists user_preferences_ui_theme_check;
alter table public.user_preferences add constraint user_preferences_ui_theme_check
  check (ui_theme = any (array['midnight','light','graphite','ocean','forest','sand','dark','system']));
