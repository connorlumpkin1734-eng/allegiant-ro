-- The redesign's light/dark/system choice, kept apart from the current app's ui_theme so changing
-- it in one version never changes the other.
alter table public.user_preferences add column if not exists ui_mode text
  check (ui_mode is null or ui_mode in ('light', 'dark', 'system'));
