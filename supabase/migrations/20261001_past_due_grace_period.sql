-- Gives a past_due shop a 7-day grace period before it goes read-only, instead of locking out
-- immediately. subscription_past_due_since is set the moment Stripe first reports a failed charge
-- (stripe-webhook.ts) and cleared the moment the shop's payment recovers.
alter table public.settings
  add column if not exists subscription_past_due_since timestamptz;

-- owner_can_write() is the single source of truth every core-table RLS policy already checks
-- (customers, vehicles, repair_orders, line_items, estimate_photos, multipoint_inspections,
-- repair_order_technicians — see migration history). Adding the grace-period case here propagates
-- to all of them with no policy changes needed.
create or replace function public.owner_can_write(target_owner_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(
    (
      select case
        when s.subscription_status in ('active', 'exempt') then true
        when s.subscription_status = 'trialing' then s.trial_ro_created_count < s.trial_ro_limit
        when s.subscription_status = 'past_due' then
          s.subscription_past_due_since is not null
          and s.subscription_past_due_since > now() - interval '7 days'
        else false
      end
      from public.settings s
      where s.owner_id = target_owner_id
    ),
    false
  );
$$;
