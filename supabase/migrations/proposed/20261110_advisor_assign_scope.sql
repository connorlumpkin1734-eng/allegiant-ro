-- Advisors could assign/unassign techs on ROs they can't see (policy only checked their role).
-- Now the RO has to be one they can see (the subquery runs under their own row-level security).
drop policy if exists "Advisors assign technicians" on public.repair_order_technicians;
create policy "Advisors assign technicians" on public.repair_order_technicians for insert
  with check (
    public.active_staff_role(owner_id) = 'service_advisor'
    and public.owner_can_write(owner_id)
    and exists (select 1 from public.repair_orders r where r.id = repair_order_id)
    and exists (select 1 from public.staff t where t.id = staff_id and t.owner_id = repair_order_technicians.owner_id and t.role = 'technician')
  );

drop policy if exists "Advisors unassign technicians" on public.repair_order_technicians;
create policy "Advisors unassign technicians" on public.repair_order_technicians for delete
  using (
    public.active_staff_role(owner_id) = 'service_advisor'
    and public.owner_can_write(owner_id)
    and exists (select 1 from public.repair_orders r where r.id = repair_order_id)
  );
