-- Anyone who can see an RO can see its estimate responses. Before, techs couldn't see them at all
-- (customer-approved jobs stayed "Waiting on customer" for the tech), and advisors only saw ones on
-- ROs they personally wrote. The subquery runs under repair_orders' own row security, so this
-- mirrors RO visibility exactly.
drop policy if exists "Advisors can view their estimate authorizations" on public.estimate_authorizations;
drop policy if exists "Staff can view authorizations on ROs they can see" on public.estimate_authorizations;
create policy "Staff can view authorizations on ROs they can see"
  on public.estimate_authorizations for select
  using (
    active_staff_id(owner_id) is not null
    and exists (select 1 from public.repair_orders ro where ro.id = estimate_authorizations.repair_order_id)
  );
