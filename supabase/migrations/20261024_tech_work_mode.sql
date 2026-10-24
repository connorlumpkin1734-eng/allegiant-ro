-- How technicians get work (per shop):
--   open        every tech can see and work every RO (no assigning needed)
--   team        techs see and work ROs given to their team (or to them personally)
--   technician  techs see and work only ROs they're assigned to (the original behavior)
-- Staff with "can view all work" (shop foreman / lead tech) or admin can work every RO in any mode.
-- Existing shops keep 'technician' so nothing changes for them until they choose.

alter table public.settings add column if not exists tech_work_mode text not null default 'open'
  check (tech_work_mode in ('open', 'team', 'technician'));
update public.settings set tech_work_mode = 'technician';

alter table public.repair_orders add column if not exists team_id uuid references public.teams(id) on delete set null;
create index if not exists repair_orders_team_id_idx on public.repair_orders (team_id);

-- The single check every technician rule uses.
create or replace function public.staff_can_work_ro(target_ro uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.repair_orders ro
    join public.staff s
      on s.owner_id = ro.owner_id and s.auth_user_id = auth.uid() and s.active
    left join public.settings st on st.owner_id = ro.owner_id
    where ro.id = target_ro
      and (
        s.can_view_all_work
        or s.is_admin
        or coalesce(st.tech_work_mode, 'technician') = 'open'
        or (st.tech_work_mode = 'team' and ro.team_id is not null and ro.team_id = s.team_id)
        or exists (
          select 1 from public.repair_order_technicians rot
          where rot.repair_order_id = ro.id and rot.staff_id = s.id
        )
      )
  );
$$;
revoke execute on function public.staff_can_work_ro(uuid) from public, anon;
grant execute on function public.staff_can_work_ro(uuid) to authenticated, service_role;

-- Technician rules: "assigned to this RO" becomes staff_can_work_ro(...).
alter policy "Staff can view scoped concern lines" on public.concern_lines using ((staff_can_view_all(owner_id) OR ((active_staff_role(owner_id) = 'service_advisor'::text) AND (EXISTS ( SELECT 1
   FROM repair_orders ro
  WHERE ((ro.id = concern_lines.repair_order_id) AND (ro.service_advisor_id = active_staff_id(ro.owner_id)))))) OR ((active_staff_role(owner_id) = 'technician'::text) AND staff_can_work_ro(concern_lines.repair_order_id))));
alter policy "Technicians add concern lines on assigned ROs" on public.concern_lines with check (((active_staff_role(owner_id) = 'technician'::text) AND owner_can_write(owner_id) AND staff_can_work_ro(concern_lines.repair_order_id)));
alter policy "Technicians update concern lines on assigned ROs" on public.concern_lines using (((active_staff_role(owner_id) = 'technician'::text) AND staff_can_work_ro(concern_lines.repair_order_id))) with check (((active_staff_role(owner_id) = 'technician'::text) AND owner_can_write(owner_id) AND staff_can_work_ro(concern_lines.repair_order_id)));
alter policy "Staff can view scoped estimate photos" on public.estimate_photos using ((staff_can_view_all(owner_id) OR ((active_staff_role(owner_id) = 'service_advisor'::text) AND (EXISTS ( SELECT 1
   FROM repair_orders ro
  WHERE ((ro.id = estimate_photos.repair_order_id) AND (ro.service_advisor_id = active_staff_id(ro.owner_id)))))) OR ((active_staff_role(owner_id) = 'technician'::text) AND staff_can_work_ro(estimate_photos.repair_order_id))));
alter policy "Technicians add photos on assigned ROs" on public.estimate_photos with check (((active_staff_role(owner_id) = 'technician'::text) AND owner_can_write(owner_id) AND staff_can_work_ro(estimate_photos.repair_order_id)));
alter policy "Staff can view scoped estimate videos" on public.estimate_videos using ((staff_can_view_all(owner_id) OR ((active_staff_role(owner_id) = 'service_advisor'::text) AND (EXISTS ( SELECT 1
   FROM repair_orders ro
  WHERE ((ro.id = estimate_videos.repair_order_id) AND (ro.service_advisor_id = active_staff_id(ro.owner_id)))))) OR ((active_staff_role(owner_id) = 'technician'::text) AND staff_can_work_ro(estimate_videos.repair_order_id))));
alter policy "Technicians add videos on assigned ROs" on public.estimate_videos with check (((active_staff_role(owner_id) = 'technician'::text) AND owner_can_write(owner_id) AND staff_can_work_ro(estimate_videos.repair_order_id)));
alter policy "Staff can view scoped line items" on public.line_items using ((staff_can_view_all(owner_id) OR ((active_staff_role(owner_id) = 'service_advisor'::text) AND (EXISTS ( SELECT 1
   FROM repair_orders ro
  WHERE ((ro.id = line_items.repair_order_id) AND (ro.service_advisor_id = active_staff_id(ro.owner_id)))))) OR ((active_staff_role(owner_id) = 'technician'::text) AND staff_can_work_ro(line_items.repair_order_id))));
alter policy "Technicians add line items on assigned ROs" on public.line_items with check (((active_staff_role(owner_id) = 'technician'::text) AND owner_can_write(owner_id) AND staff_can_work_ro(line_items.repair_order_id)));
alter policy "Technicians update line items on assigned ROs" on public.line_items using (((active_staff_role(owner_id) = 'technician'::text) AND staff_can_work_ro(line_items.repair_order_id))) with check (((active_staff_role(owner_id) = 'technician'::text) AND owner_can_write(owner_id) AND staff_can_work_ro(line_items.repair_order_id)));
alter policy "Staff can view scoped inspections" on public.multipoint_inspections using ((staff_can_view_all(owner_id) OR ((active_staff_role(owner_id) = 'service_advisor'::text) AND (EXISTS ( SELECT 1
   FROM repair_orders ro
  WHERE ((ro.id = multipoint_inspections.repair_order_id) AND (ro.service_advisor_id = active_staff_id(ro.owner_id)))))) OR ((active_staff_role(owner_id) = 'technician'::text) AND staff_can_work_ro(multipoint_inspections.repair_order_id))));
alter policy "Technicians manage inspections on assigned ROs insert" on public.multipoint_inspections with check (((active_staff_role(owner_id) = 'technician'::text) AND owner_can_write(owner_id) AND staff_can_work_ro(multipoint_inspections.repair_order_id)));
alter policy "Technicians manage inspections on assigned ROs update" on public.multipoint_inspections using (((active_staff_role(owner_id) = 'technician'::text) AND staff_can_work_ro(multipoint_inspections.repair_order_id))) with check (((active_staff_role(owner_id) = 'technician'::text) AND owner_can_write(owner_id) AND staff_can_work_ro(multipoint_inspections.repair_order_id)));
alter policy "Staff can view scoped repair orders" on public.repair_orders using ((staff_can_view_all(owner_id) OR ((active_staff_role(owner_id) = 'service_advisor'::text) AND (service_advisor_id = active_staff_id(owner_id))) OR ((active_staff_role(owner_id) = 'technician'::text) AND staff_can_work_ro(repair_orders.id))));
