-- Lead technician: sees all of their team's ROs and assigns their team's techs to them.
alter table public.staff add column if not exists is_team_lead boolean not null default false;

-- The team the signed-in staff member leads (null if they aren't an active lead tech with a team).
create or replace function public.staff_lead_team_id(target_owner uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from public.staff
  where owner_id = target_owner and auth_user_id = auth.uid() and active
    and is_team_lead and role = 'technician' and team_id is not null
  limit 1
$$;

-- True when the signed-in staff member leads the team this RO is sent to.
create or replace function public.staff_leads_ro_team(target_ro uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.repair_orders ro
    join public.staff s on s.owner_id = ro.owner_id and s.auth_user_id = auth.uid() and s.active
    where ro.id = target_ro and s.is_team_lead and s.role = 'technician'
      and ro.team_id is not null and ro.team_id = s.team_id
  )
$$;

create or replace function public.staff_can_work_ro(target_ro uuid) returns boolean
language sql stable security definer set search_path = public as $$
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
        or (s.is_team_lead and s.role = 'technician' and ro.team_id is not null and ro.team_id = s.team_id)
        or exists (
          select 1 from public.repair_order_technicians rot
          where rot.repair_order_id = ro.id and rot.staff_id = s.id
        )
      )
  );
$$;

revoke all on function public.staff_lead_team_id(uuid) from public, anon;
revoke all on function public.staff_leads_ro_team(uuid) from public, anon;
grant execute on function public.staff_lead_team_id(uuid) to authenticated;
grant execute on function public.staff_leads_ro_team(uuid) to authenticated;

-- A lead can see the people on their team (to assign them).
drop policy if exists "Team leads view their team" on public.staff;
create policy "Team leads view their team" on public.staff for select
  using (team_id is not null and team_id = public.staff_lead_team_id(owner_id));

-- ...and who is assigned on their team's ROs, and change it — only to techs on their own team.
drop policy if exists "Team leads view team assignments" on public.repair_order_technicians;
create policy "Team leads view team assignments" on public.repair_order_technicians for select
  using (public.staff_leads_ro_team(repair_order_id));

drop policy if exists "Team leads assign their team" on public.repair_order_technicians;
create policy "Team leads assign their team" on public.repair_order_technicians for insert
  with check (
    public.owner_can_write(owner_id)
    and public.staff_leads_ro_team(repair_order_id)
    and exists (
      select 1 from public.staff t
      where t.id = staff_id and t.owner_id = repair_order_technicians.owner_id and t.active
        and t.role = 'technician' and t.team_id = public.staff_lead_team_id(repair_order_technicians.owner_id)
    )
  );

drop policy if exists "Team leads unassign their team" on public.repair_order_technicians;
create policy "Team leads unassign their team" on public.repair_order_technicians for delete
  using (public.owner_can_write(owner_id) and public.staff_leads_ro_team(repair_order_id));
