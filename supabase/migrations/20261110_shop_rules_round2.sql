-- Connor's calls after the 2-team stress test (2026-11-09):
--  1. A tech who recommended work stays on that car by default (override = "Remove anyway").
--  2. Advisors see every car on their team, plus anything they wrote; they can only assign
--     techs on cars they can see (folds in proposed/20261110_advisor_assign_scope.sql).
--  3. Techs only see customers/vehicles for cars they can see, unless they have advisor/admin access.
--  4. Techs can't change labor on approved jobs, or add labor to them.

-- ---------- 2. Advisor scope ----------
create or replace function public.staff_is_advisor_for(target_owner uuid, ro_advisor uuid, ro_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff s
    where s.owner_id = target_owner and s.auth_user_id = auth.uid() and s.active
      and (case when s.is_admin then 'service_advisor' else s.role end) = 'service_advisor'
      and (s.id = ro_advisor or (ro_team is not null and ro_team = s.team_id))
  )
$$;
create or replace function public.staff_advises_ro(target_ro uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.repair_orders ro
    where ro.id = target_ro and public.staff_is_advisor_for(ro.owner_id, ro.service_advisor_id, ro.team_id)
  )
$$;
revoke all on function public.staff_is_advisor_for(uuid, uuid, uuid) from public, anon;
revoke all on function public.staff_advises_ro(uuid) from public, anon;
grant execute on function public.staff_is_advisor_for(uuid, uuid, uuid) to authenticated;
grant execute on function public.staff_advises_ro(uuid) to authenticated;

drop policy if exists "Staff can view scoped repair orders" on public.repair_orders;
create policy "Staff can view scoped repair orders" on public.repair_orders for select using (
  public.staff_can_view_all(owner_id)
  or public.staff_is_advisor_for(owner_id, service_advisor_id, team_id)
  or (public.active_staff_role(owner_id) = 'technician' and public.staff_can_work_ro(id))
);

drop policy if exists "Staff can view scoped line items" on public.line_items;
create policy "Staff can view scoped line items" on public.line_items for select using (
  public.staff_can_view_all(owner_id) or public.staff_advises_ro(repair_order_id)
  or (public.active_staff_role(owner_id) = 'technician' and public.staff_can_work_ro(repair_order_id))
);
drop policy if exists "Staff can view scoped concern lines" on public.concern_lines;
create policy "Staff can view scoped concern lines" on public.concern_lines for select using (
  public.staff_can_view_all(owner_id) or public.staff_advises_ro(repair_order_id)
  or (public.active_staff_role(owner_id) = 'technician' and public.staff_can_work_ro(repair_order_id))
);
drop policy if exists "Staff can view scoped estimate photos" on public.estimate_photos;
create policy "Staff can view scoped estimate photos" on public.estimate_photos for select using (
  public.staff_can_view_all(owner_id) or public.staff_advises_ro(repair_order_id)
  or (public.active_staff_role(owner_id) = 'technician' and public.staff_can_work_ro(repair_order_id))
);
drop policy if exists "Staff can view scoped estimate videos" on public.estimate_videos;
create policy "Staff can view scoped estimate videos" on public.estimate_videos for select using (
  public.staff_can_view_all(owner_id) or public.staff_advises_ro(repair_order_id)
  or (public.active_staff_role(owner_id) = 'technician' and public.staff_can_work_ro(repair_order_id))
);
drop policy if exists "Staff can view scoped inspections" on public.multipoint_inspections;
create policy "Staff can view scoped inspections" on public.multipoint_inspections for select using (
  public.staff_can_view_all(owner_id) or public.staff_advises_ro(repair_order_id)
  or (public.active_staff_role(owner_id) = 'technician' and public.staff_can_work_ro(repair_order_id))
);

-- Advisors assign/unassign only on cars they can see, and only technicians.
drop policy if exists "Advisors assign technicians" on public.repair_order_technicians;
create policy "Advisors assign technicians" on public.repair_order_technicians for insert with check (
  public.active_staff_role(owner_id) = 'service_advisor'
  and public.owner_can_write(owner_id)
  and exists (select 1 from public.repair_orders r where r.id = repair_order_id)
  and exists (select 1 from public.staff t where t.id = staff_id and t.owner_id = repair_order_technicians.owner_id and t.role = 'technician')
);
drop policy if exists "Advisors unassign technicians" on public.repair_order_technicians;
create policy "Advisors unassign technicians" on public.repair_order_technicians for delete using (
  public.active_staff_role(owner_id) = 'service_advisor'
  and public.owner_can_write(owner_id)
  and exists (select 1 from public.repair_orders r where r.id = repair_order_id)
);

-- ---------- 3. Customer privacy ----------
drop policy if exists "Staff can view customers" on public.customers;
create policy "Staff can view customers" on public.customers for select using (
  public.staff_can_view_all(owner_id)
  or public.active_staff_role(owner_id) = 'service_advisor'
  or exists (select 1 from public.repair_orders ro where ro.customer_id = customers.id)
);
drop policy if exists "Staff can view vehicles" on public.vehicles;
create policy "Staff can view vehicles" on public.vehicles for select using (
  public.staff_can_view_all(owner_id)
  or public.active_staff_role(owner_id) = 'service_advisor'
  or exists (select 1 from public.repair_orders ro where ro.vehicle_id = vehicles.id)
);

-- ---------- 1. Recommending tech stays on the car ----------
create or replace function public.tech_has_open_recommendation(target_ro uuid, target_staff uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.line_items li
    where li.repair_order_id = target_ro and li.recommended_by = target_staff
      and coalesce(li.job_status, '') <> 'declined' and coalesce(li.job_progress, '') <> 'done'
  )
$$;
revoke all on function public.tech_has_open_recommendation(uuid, uuid) from public, anon;
grant execute on function public.tech_has_open_recommendation(uuid, uuid) to authenticated;

create or replace function public.guard_recommending_tech() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.force_unassign', true), '') = 'on' then return old; end if;
  -- The RO or the staff member is being deleted: let the cascade through.
  if not exists (select 1 from public.repair_orders where id = old.repair_order_id) then return old; end if;
  if not exists (select 1 from public.staff where id = old.staff_id) then return old; end if;
  if public.tech_has_open_recommendation(old.repair_order_id, old.staff_id) then
    raise exception 'RECOMMENDED_WORK: this tech recommended work on this car that isn''t finished yet.'
      using errcode = 'P0001', hint = 'Use "Remove anyway" to take them off.';
  end if;
  return old;
end $$;
revoke all on function public.guard_recommending_tech() from public, anon, authenticated;
drop trigger if exists repair_order_technicians_keep_recommender on public.repair_order_technicians;
create trigger repair_order_technicians_keep_recommender
  before delete on public.repair_order_technicians
  for each row execute function public.guard_recommending_tech();

-- The override. Runs as the caller, so the normal who-can-unassign rules still apply.
create or replace function public.remove_tech_from_ro(p_ro uuid, p_staff uuid, p_force boolean default false) returns integer
language plpgsql security invoker set search_path = public as $$
declare removed integer;
begin
  if p_force then perform set_config('app.force_unassign', 'on', true); end if;
  delete from public.repair_order_technicians where repair_order_id = p_ro and staff_id = p_staff;
  get diagnostics removed = row_count;
  perform set_config('app.force_unassign', 'off', true);
  return removed;
end $$;
revoke all on function public.remove_tech_from_ro(uuid, uuid, boolean) from public, anon;
grant execute on function public.remove_tech_from_ro(uuid, uuid, boolean) to authenticated;

-- Moving a car to another team keeps a tech who has open recommended work on it.
create or replace function public.drop_other_team_techs_on_team_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.team_id is not null and new.team_id is distinct from old.team_id then
    delete from public.repair_order_technicians rot
    using public.staff s
    where rot.repair_order_id = new.id
      and s.id = rot.staff_id
      and s.team_id is not null
      and s.team_id <> new.team_id
      and not public.tech_has_open_recommendation(new.id, s.id);
  end if;
  return new;
end $$;

-- ---------- 4. Approved labor is fixed for techs ----------
create or replace function public.protect_line_concern_from_technicians() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  sibling record;
  staff_role text := public.active_staff_role(new.owner_id);
  shop record;
begin
  if new.concern_line_id is not null and not exists (
    select 1 from public.concern_lines cl
    where cl.id = new.concern_line_id and cl.repair_order_id = new.repair_order_id
  ) then
    raise exception 'Concern line does not belong to this repair order.';
  end if;

  if staff_role is null then
    return new;
  end if;

  select s.default_labor_rate, s.techs_can_price, s.advisors_can_change_labor_rate
    into shop
  from public.settings s where s.owner_id = new.owner_id limit 1;

  if staff_role = 'service_advisor' then
    if new.item_type = 'labor'
       and not coalesce(shop.advisors_can_change_labor_rate, false)
       and not public.staff_is_admin(new.owner_id) then
      if tg_op = 'UPDATE' and old.item_type = 'labor' then
        new.unit_price := old.unit_price;
      else
        new.unit_price := coalesce(shop.default_labor_rate, new.unit_price);
      end if;
    end if;
    return new;
  end if;

  if staff_role is distinct from 'technician' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    new.service_concern := old.service_concern;
    new.job_status := old.job_status;
    new.concern_line_id := old.concern_line_id;
    if old.item_type = 'labor' then
      new.unit_price := old.unit_price;
    end if;
    -- The customer approved this labor: hours and wording stay as approved.
    if old.job_status = 'authorized' then
      new.item_type := old.item_type;
      if old.item_type = 'labor' then
        new.quantity := old.quantity;
        new.description := old.description;
      end if;
    end if;
    if old.item_type = 'part' and not coalesce(shop.techs_can_price, true) then
      new.unit_price := old.unit_price;
      new.unit_cost := old.unit_cost;
      new.markup_percent := old.markup_percent;
      new.price_manual := old.price_manual;
    end if;
    return new;
  end if;

  select li.service_concern, li.job_status, li.concern_line_id into sibling
  from public.line_items li
  where li.repair_order_id = new.repair_order_id
    and new.service_group_id is not null
    and li.service_group_id = new.service_group_id
    and li.id <> new.id
  order by li.sort_order
  limit 1;

  if found then
    if sibling.job_status = 'authorized' and new.item_type = 'labor' then
      raise exception 'This job is already approved. Add extra labor as a new recommendation so the advisor can get it OK''d.';
    end if;
    new.service_concern := sibling.service_concern;
    new.job_status := sibling.job_status;
    new.concern_line_id := sibling.concern_line_id;
  else
    new.service_concern := null;
    new.job_status := case when new.service_group_id is null then new.job_status else 'pending_review' end;
  end if;

  if new.item_type = 'labor' then
    new.unit_price := coalesce(shop.default_labor_rate, new.unit_price);
  end if;
  if new.item_type = 'part' and not coalesce(shop.techs_can_price, true) then
    new.unit_price := 0;
    new.unit_cost := null;
    new.markup_percent := null;
    new.price_manual := false;
  end if;
  return new;
end;
$$;
