-- Billing, trial and payment-connection fields on settings can only be changed by the server
-- (Netlify functions using the service role, Stripe webhooks, platform admin, database triggers).
-- Before this, a shop owner or admin could set their own subscription to "exempt", change their
-- own monthly price, raise their trial limit, or fake a Stripe connection straight from the browser.
-- Changes from signed-in users to these columns are quietly ignored (the old value is kept), so the
-- normal Settings save, which sends the whole row, keeps working.

create or replace function public.protect_settings_billing_fields()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- Only browser sessions are restricted. The service role, the database owner and
  -- security-definer functions (e.g. the trial counter) are trusted.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A brand-new shop always starts as a normal trial with nothing connected.
    new.subscription_status := 'trialing';
    new.plan_price_cents := null;            -- filled from the platform default by trg_set_default_plan_price
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
  -- Each shop owns exactly one settings row; it can't be moved to another account.
  new.owner_id := old.owner_id;
  return new;
end;
$$;
revoke execute on function public.protect_settings_billing_fields() from public, anon, authenticated;

-- Named to sort before trg_set_default_plan_price so the default price is filled in after this.
drop trigger if exists settings_protect_billing_fields on public.settings;
create trigger settings_protect_billing_fields
  before insert or update on public.settings
  for each row execute function public.protect_settings_billing_fields();
