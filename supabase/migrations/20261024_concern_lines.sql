-- Concern lines (dealer-style RO): Line A / B / C, each with Concern / Cause / Correction,
-- and service jobs underneath. ADDITIVE ONLY: no existing column or table is dropped or changed
-- in a way the previous app version depends on.
--
--   concern_lines            one row per line on an RO
--   line_items.concern_line_id   which line a job belongs to
--   line_items.job_status    authorized | needs_approval | pending_review   (per job, stored on each of its rows)
--   line_items.job_note      optional short note for one job (e.g. "pads at 2mm")
--
-- Technicians: may add/update Cause & Correction, may start a "Found during inspection" line,
-- may request jobs (always created as pending_review), may set labor hours (never the rate).
-- They can never change a concern, a line's type, a job's status, or a job's line.

-- 1) Table ---------------------------------------------------------------------------------
create table if not exists public.concern_lines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  repair_order_id uuid not null references public.repair_orders(id) on delete cascade,
  sort_order integer not null default 0,
  kind text not null default 'customer' check (kind in ('customer', 'inspection')),
  concern text,
  cause text,
  correction text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists concern_lines_repair_order_id_idx on public.concern_lines (repair_order_id);
create index if not exists concern_lines_owner_id_idx on public.concern_lines (owner_id);

grant select, insert, update, delete on public.concern_lines to anon, authenticated, service_role;
alter table public.concern_lines enable row level security;

drop trigger if exists concern_lines_set_updated_at on public.concern_lines;
create trigger concern_lines_set_updated_at before update on public.concern_lines
  for each row execute function public.set_updated_at();

-- Same access rules as line_items.
create policy "Owners view their concern lines" on public.concern_lines for select
  using (owner_id = (select auth.uid()));
create policy "Owners insert their concern lines" on public.concern_lines for insert
  with check (owner_id = (select auth.uid()) and owner_can_write(owner_id));
create policy "Owners update their concern lines" on public.concern_lines for update
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and owner_can_write(owner_id));
create policy "Owners delete their concern lines" on public.concern_lines for delete
  using (owner_id = (select auth.uid()) and owner_can_write(owner_id));

create policy "Staff can view scoped concern lines" on public.concern_lines for select
  using (
    staff_can_view_all(owner_id)
    or (active_staff_role(owner_id) = 'service_advisor' and exists (
      select 1 from public.repair_orders ro
      where ro.id = concern_lines.repair_order_id and ro.service_advisor_id = active_staff_id(ro.owner_id)))
    or (active_staff_role(owner_id) = 'technician' and exists (
      select 1 from public.repair_order_technicians rot
      where rot.repair_order_id = concern_lines.repair_order_id and rot.staff_id = active_staff_id(rot.owner_id)))
  );
create policy "Advisors insert concern lines" on public.concern_lines for insert
  with check (active_staff_role(owner_id) = 'service_advisor' and owner_can_write(owner_id));
create policy "Advisors update concern lines" on public.concern_lines for update
  using (active_staff_role(owner_id) = 'service_advisor')
  with check (active_staff_role(owner_id) = 'service_advisor' and owner_can_write(owner_id));
create policy "Advisors delete concern lines" on public.concern_lines for delete
  using (active_staff_role(owner_id) = 'service_advisor' and owner_can_write(owner_id));
create policy "Technicians add concern lines on assigned ROs" on public.concern_lines for insert
  with check (active_staff_role(owner_id) = 'technician' and owner_can_write(owner_id) and exists (
    select 1 from public.repair_order_technicians rot
    where rot.repair_order_id = concern_lines.repair_order_id and rot.staff_id = active_staff_id(rot.owner_id)));
create policy "Technicians update concern lines on assigned ROs" on public.concern_lines for update
  using (active_staff_role(owner_id) = 'technician' and exists (
    select 1 from public.repair_order_technicians rot
    where rot.repair_order_id = concern_lines.repair_order_id and rot.staff_id = active_staff_id(rot.owner_id)))
  with check (active_staff_role(owner_id) = 'technician' and owner_can_write(owner_id) and exists (
    select 1 from public.repair_order_technicians rot
    where rot.repair_order_id = concern_lines.repair_order_id and rot.staff_id = active_staff_id(rot.owner_id)));

-- Technicians: only "Found during inspection" lines; never edit a concern, type or order.
create or replace function public.protect_concern_lines_from_technicians()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if public.active_staff_role(new.owner_id) is distinct from 'technician' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.kind := 'inspection';
    new.concern := null;
  else
    new.kind := old.kind;
    new.concern := old.concern;
    new.sort_order := old.sort_order;
    new.repair_order_id := old.repair_order_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.protect_concern_lines_from_technicians() from public, anon, authenticated;
drop trigger if exists concern_lines_protect on public.concern_lines;
create trigger concern_lines_protect before insert or update on public.concern_lines
  for each row execute function public.protect_concern_lines_from_technicians();

-- 2) New job columns -------------------------------------------------------------------------
alter table public.line_items add column if not exists concern_line_id uuid references public.concern_lines(id) on delete set null;
alter table public.line_items add column if not exists job_status text check (job_status in ('authorized', 'needs_approval', 'pending_review'));
alter table public.line_items add column if not exists job_note text;
create index if not exists line_items_concern_line_id_idx on public.line_items (concern_line_id);

-- Job rules for technicians (extends the existing concern protection on line_items).
create or replace function public.protect_line_concern_from_technicians()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  sibling record;
begin
  -- Everyone: a job can only point at a concern line on the same RO.
  if new.concern_line_id is not null and not exists (
    select 1 from public.concern_lines cl
    where cl.id = new.concern_line_id and cl.repair_order_id = new.repair_order_id
  ) then
    raise exception 'Concern line does not belong to this repair order.';
  end if;

  if public.active_staff_role(new.owner_id) is distinct from 'technician' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    new.service_concern := old.service_concern;
    new.job_status := old.job_status;
    new.concern_line_id := old.concern_line_id;
    if old.item_type = 'labor' then
      new.unit_price := old.unit_price;   -- techs set hours, never the labor rate
    end if;
    return new;
  end if;

  -- INSERT: a line added to an existing job inherits that job's concern, status and line.
  select li.service_concern, li.job_status, li.concern_line_id into sibling
  from public.line_items li
  where li.repair_order_id = new.repair_order_id
    and new.service_group_id is not null
    and li.service_group_id = new.service_group_id
    and li.id <> new.id
  order by li.sort_order
  limit 1;

  if found then
    new.service_concern := sibling.service_concern;
    new.job_status := sibling.job_status;
    new.concern_line_id := sibling.concern_line_id;
  else
    -- A brand-new job from a technician is always a request for the advisor to review.
    new.service_concern := null;
    new.job_status := case when new.service_group_id is null then new.job_status else 'pending_review' end;
  end if;

  if new.item_type = 'labor' then
    new.unit_price := coalesce(
      (select s.default_labor_rate from public.settings s where s.owner_id = new.owner_id limit 1),
      new.unit_price);
  end if;
  return new;
end;
$$;
revoke execute on function public.protect_line_concern_from_technicians() from public, anon, authenticated;

-- 3) Convert existing ROs: each existing service job becomes its own concern line ----------
--    (concern = job's concern if any, cause = technician story, correction = work performed).
--    The original columns are left untouched.
do $$
declare
  g record;
  new_line uuid;
begin
  for g in
    select li.repair_order_id, li.service_group_id, min(li.owner_id::text)::uuid as owner_id,
           min(li.sort_order) as sort_order,
           max(li.service_concern) as concern, max(li.technician_story) as cause, max(li.work_performed) as correction
    from public.line_items li
    where li.service_group_id is not null and li.concern_line_id is null
    group by li.repair_order_id, li.service_group_id
  loop
    insert into public.concern_lines (owner_id, repair_order_id, sort_order, kind, concern, cause, correction)
    values (g.owner_id, g.repair_order_id, g.sort_order, 'customer', g.concern, g.cause, g.correction)
    returning id into new_line;

    update public.line_items
    set concern_line_id = new_line,
        job_status = coalesce(job_status, 'needs_approval')
    where repair_order_id = g.repair_order_id and service_group_id = g.service_group_id;
  end loop;
end $$;
