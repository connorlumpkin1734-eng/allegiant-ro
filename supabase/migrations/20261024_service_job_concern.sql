-- 3C repair orders: each service job gets its own Concern (written by the advisor).
-- Cause = technician_story, Correction = work_performed (existing columns).
--
-- Like the other job fields, the concern is stored on every line item of the job.
-- Technicians can read it but never change it: a technician's save keeps whatever
-- the advisor wrote, and lines a technician adds to a job inherit the job's concern.
-- The same protection applies to the RO-level customer concern.

alter table public.line_items add column if not exists service_concern text;

create or replace function public.protect_line_concern_from_technicians()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.active_staff_role(new.owner_id) is distinct from 'technician' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    new.service_concern := old.service_concern;
  else
    new.service_concern := (
      select li.service_concern
      from public.line_items li
      where li.repair_order_id = new.repair_order_id
        and new.service_group_id is not null
        and li.service_group_id = new.service_group_id
        and li.id <> new.id
      order by li.sort_order
      limit 1
    );
  end if;
  return new;
end;
$$;

create or replace function public.protect_ro_concern_from_technicians()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.active_staff_role(new.owner_id) = 'technician' then
    new.customer_concern := old.customer_concern;
  end if;
  return new;
end;
$$;

-- Trigger-only: not callable through the API.
revoke execute on function public.protect_line_concern_from_technicians() from public, anon, authenticated;
revoke execute on function public.protect_ro_concern_from_technicians() from public, anon, authenticated;

drop trigger if exists line_items_protect_concern on public.line_items;
create trigger line_items_protect_concern
  before insert or update on public.line_items
  for each row execute function public.protect_line_concern_from_technicians();

drop trigger if exists repair_orders_protect_concern on public.repair_orders;
create trigger repair_orders_protect_concern
  before update on public.repair_orders
  for each row execute function public.protect_ro_concern_from_technicians();
