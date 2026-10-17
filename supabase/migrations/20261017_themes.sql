-- Appearance options.
--
-- 1) settings.document_template: which layout the SHOP's customer-facing estimates and invoices use.
--    A shop-level choice (customers see the shop's brand), set by the owner/admin in Settings →
--    Branding. send-estimate.ts also freezes the value into each estimate snapshot so an old link keeps
--    the look it was sent with. Existing shops default to 'standard', the layout they already have.
--
-- 2) user_preferences.ui_theme: which color theme THIS PERSON sees in the shop app. Per-user, because
--    staff share one shop but not one screen. Each user can read and write only their own row.
alter table public.settings
  add column if not exists document_template text not null default 'standard'
  check (document_template in ('standard', 'clean', 'bold', 'classic', 'modern', 'elegant'));

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ui_theme text not null default 'midnight'
    check (ui_theme in ('midnight', 'light', 'graphite', 'ocean', 'forest', 'sand')),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

create policy "Users manage their own preferences" on public.user_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
