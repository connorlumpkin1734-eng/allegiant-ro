-- Parts pricing: flat markup or a cost-based (sliding or stepped) matrix, a per-line "manual price"
-- flag, and a shop setting for whether service advisors may change the labor rate on a line.
-- Also enforces "Technicians can price parts" in the database (it was only enforced on screen).

alter table public.settings
  add column if not exists parts_pricing_mode text not null default 'flat'
    check (parts_pricing_mode in ('flat', 'matrix')),
  add column if not exists parts_matrix jsonb not null default
    '[{"cost":0,"markup":200},{"cost":10,"markup":150},{"cost":50,"markup":100},{"cost":150,"markup":70},{"cost":500,"markup":45},{"cost":1000,"markup":30}]'::jsonb
    check (jsonb_typeof(parts_matrix) = 'array' and jsonb_array_length(parts_matrix) between 1 and 20),
  add column if not exists parts_matrix_sliding boolean not null default true,
  add column if not exists advisors_can_change_labor_rate boolean not null default false;

alter table public.line_items
  add column if not exists price_manual boolean not null default false;

create or replace function public.protect_line_concern_from_technicians()
returns trigger language plpgsql security definer set search_path to 'public' as $$
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

  -- Owners (no staff row) are never restricted.
  if staff_role is null then
    return new;
  end if;

  select s.default_labor_rate, s.techs_can_price, s.advisors_can_change_labor_rate
    into shop
  from public.settings s where s.owner_id = new.owner_id limit 1;

  -- Service advisors (not admins): labor rate is locked to the shop rate unless the shop allows changes.
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
revoke execute on function public.protect_line_concern_from_technicians() from public, anon, authenticated;
