-- Who to credit: the advisor who wrote the RO, and the tech who recommended a repair.
alter table public.line_items
  add column if not exists recommended_by uuid references public.staff(id) on delete set null;

create or replace function public.stamp_recommended_by()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.job_status = 'pending_review' and new.recommended_by is null then
    new.recommended_by := public.active_staff_id(new.owner_id);
  end if;
  return new;
end;
$$;

drop trigger if exists line_items_stamp_recommended_by on public.line_items;
create trigger line_items_stamp_recommended_by
  before insert on public.line_items
  for each row execute function public.stamp_recommended_by();

create or replace function public.stamp_service_advisor()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  writer uuid;
begin
  if new.service_advisor_id is null then
    select id into writer from public.staff
     where owner_id = new.owner_id and auth_user_id = auth.uid() and active
       and (role <> 'technician' or is_admin)
     limit 1;
    new.service_advisor_id := writer; -- stays null when the owner writes it: credited to the owner
  end if;
  return new;
end;
$$;

drop trigger if exists repair_orders_stamp_service_advisor on public.repair_orders;
create trigger repair_orders_stamp_service_advisor
  before insert on public.repair_orders
  for each row execute function public.stamp_service_advisor();

-- Backfill: recommendations already on file get credited to the RO's assigned tech when there's exactly one.
update public.line_items li
   set recommended_by = t.staff_id
  from (
    select repair_order_id, min(staff_id::text)::uuid as staff_id
      from public.repair_order_technicians
     group by repair_order_id
    having count(*) = 1
  ) t
 where li.repair_order_id = t.repair_order_id
   and li.recommended_by is null
   and li.job_status = 'pending_review';
