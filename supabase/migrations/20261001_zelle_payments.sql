-- Adds Zelle as a second, manual-confirmation payment method for shops' own customers, alongside
-- the existing Stripe Connect flow. Zelle has no business API, so there's no automatic webhook —
-- a customer claims they've sent payment (status -> 'processing'), which alerts the shop, and a
-- staff member confirms it was actually received (status -> 'succeeded') before the repair order
-- is marked paid. See request-zelle-payment.ts, pay-zelle.ts, and confirm-zelle-payment.ts.

alter table public.settings add column if not exists zelle_recipient text;

alter table public.payments drop constraint if exists payments_processor_check;
alter table public.payments add constraint payments_processor_check check (processor in ('stripe', 'zelle'));

alter table public.payments add column if not exists token_hash text;
alter table public.payments add column if not exists confirmed_by uuid references auth.users(id);
alter table public.payments add column if not exists confirmation_note text;

create unique index if not exists payments_token_hash_unique_idx on public.payments (token_hash) where token_hash is not null;
