-- Square as a second card processor. A shop links its own Square account (OAuth); ROrunner never
-- holds funds or pays fees. Each shop uses one card processor at a time (settings.card_processor).

alter table public.settings
  add column if not exists square_merchant_id text,
  add column if not exists square_location_id text,
  add column if not exists square_location_name text,
  add column if not exists card_processor text;

alter table public.settings drop constraint if exists settings_card_processor_check;
alter table public.settings add constraint settings_card_processor_check
  check (card_processor is null or card_processor in ('stripe', 'square'));

-- Square tokens. Server-only: no browser role can read or write this table.
create table if not exists public.square_connections (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  merchant_id text not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.square_connections enable row level security;
revoke all on public.square_connections from anon, authenticated;
grant all on public.square_connections to service_role;

-- One-time "state" values for the Square OAuth round trip (proves the callback belongs to the
-- owner who started it). Server-only, expire after 15 minutes.
create table if not exists public.square_oauth_states (
  state_hash text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.square_oauth_states enable row level security;
revoke all on public.square_oauth_states from anon, authenticated;
grant all on public.square_oauth_states to service_role;

-- Square connection fields are set by the server only, like the Stripe ones.
create or replace function public.protect_settings_billing_fields()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.subscription_status := 'trialing';
    new.plan_price_cents := null;
    new.trial_ro_limit := 5;
    new.trial_ro_created_count := 0;
    new.is_platform_admin := false;
    new.stripe_customer_id := null;
    new.stripe_subscription_id := null;
    new.subscription_current_period_end := null;
    new.subscription_past_due_since := null;
    new.stripe_account_id := null;
    new.stripe_account_type := null;
    new.stripe_onboarding_complete := false;
    new.stripe_charges_enabled := false;
    new.stripe_payouts_enabled := false;
    new.square_merchant_id := null;
    new.square_location_id := null;
    new.square_location_name := null;
    return new;
  end if;

  new.subscription_status := old.subscription_status;
  new.plan_price_cents := old.plan_price_cents;
  new.trial_ro_limit := old.trial_ro_limit;
  new.trial_ro_created_count := old.trial_ro_created_count;
  new.is_platform_admin := old.is_platform_admin;
  new.stripe_customer_id := old.stripe_customer_id;
  new.stripe_subscription_id := old.stripe_subscription_id;
  new.subscription_current_period_end := old.subscription_current_period_end;
  new.subscription_past_due_since := old.subscription_past_due_since;
  new.stripe_account_id := old.stripe_account_id;
  new.stripe_account_type := old.stripe_account_type;
  new.stripe_onboarding_complete := old.stripe_onboarding_complete;
  new.stripe_charges_enabled := old.stripe_charges_enabled;
  new.stripe_payouts_enabled := old.stripe_payouts_enabled;
  new.square_merchant_id := old.square_merchant_id;
  new.square_location_id := old.square_location_id;
  new.square_location_name := old.square_location_name;
  new.owner_id := old.owner_id;
  return new;
end;
$function$;
