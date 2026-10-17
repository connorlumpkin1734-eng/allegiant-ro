-- Token-gated links to a repair order's video clips, used by the invoice email. Email clients
-- can't play video inline, so the invoice carries a "Watch your repair videos" button that opens
-- /repair-videos?token=... instead.
--
-- Same pattern as estimate_authorizations: only the SHA-256 of the token is stored, and the page's
-- content is a frozen snapshot taken when the email was sent (business branding, ro number, vehicle,
-- and the R2 object keys of the videos). The Netlify function re-signs fresh R2 playback URLs on every
-- view, so the raw R2 key never reaches the customer's browser and old links never hold a long-lived
-- URL. Links expire after 90 days.
--
-- RLS is enabled with NO policies on purpose: this table is only ever read/written by Netlify
-- functions using the service-role key. Shop users and anonymous visitors cannot touch it directly.
create table public.video_share_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  repair_order_id uuid not null references public.repair_orders(id),
  token_hash text not null unique,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days')
);

alter table public.video_share_links enable row level security;

create index video_share_links_repair_order_id_idx on public.video_share_links (repair_order_id);
