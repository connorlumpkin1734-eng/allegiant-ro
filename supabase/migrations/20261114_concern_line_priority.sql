-- Line priority: Safety / Soon / Can wait on each concern line. ADDITIVE ONLY:
-- a nullable column the current app never sends, so its upserts leave it untouched.
alter table public.concern_lines
  add column if not exists priority text
  check (priority is null or priority in ('safety', 'soon', 'later'));
