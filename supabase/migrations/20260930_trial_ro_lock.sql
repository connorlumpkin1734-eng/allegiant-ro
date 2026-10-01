-- Anti-abuse guard for the free trial: a shop still on "trialing" gets 5 repair orders total
-- (enforced elsewhere by trg_bump_trial_ro_count, which only ever counts up on creation and never
-- recounts). Without this, someone could create exactly 5 ROs and then keep swapping the customer
-- and vehicle on one of them forever, servicing unlimited customers under a single RO slot.
--
-- Rule: once a repair order has at least one line item, its customer_id/vehicle_id can no longer be
-- changed, but only while the shop is still on "trialing". A shop that's actively subscribed
-- (active/exempt/past_due/canceled) is never affected by this — it's purely a trial-abuse guard, not
-- a general product restriction. Techs/owners can still fix a wrong customer/vehicle up until the
-- first line item is added.

create or replace function public.enforce_trial_ro_customer_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  shop_status text;
  existing_line_items integer;
begin
  if new.customer_id is not distinct from old.customer_id
     and new.vehicle_id is not distinct from old.vehicle_id then
    return new;
  end if;

  select subscription_status into shop_status
  from public.settings
  where owner_id = new.owner_id;

  if shop_status is distinct from 'trialing' then
    return new;
  end if;

  select count(*) into existing_line_items
  from public.line_items
  where repair_order_id = new.id;

  if existing_line_items > 0 then
    raise exception 'This repair order already has line items on it — the customer and vehicle can no longer be changed during the free trial. Subscribe to lift this limit.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_trial_ro_customer_lock on public.repair_orders;
create trigger trg_enforce_trial_ro_customer_lock
before update on public.repair_orders
for each row execute function public.enforce_trial_ro_customer_lock();
