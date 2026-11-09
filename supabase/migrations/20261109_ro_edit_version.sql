-- A counter that goes up on any change to an RO or anything on it (lines, concern lines, assigned
-- techs). The editor remembers the number it loaded and checks it before saving, so two people
-- working the same RO can't silently overwrite each other.
alter table public.repair_orders add column if not exists edit_version bigint not null default 0;

create or replace function public.bump_ro_edit_version_self()
returns trigger language plpgsql as $$
begin
  new.edit_version := coalesce(old.edit_version, 0) + 1;
  return new;
end;
$$;

drop trigger if exists repair_orders_bump_edit_version on public.repair_orders;
create trigger repair_orders_bump_edit_version
  before update on public.repair_orders
  for each row execute function public.bump_ro_edit_version_self();

create or replace function public.bump_ro_edit_version_from_child()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ro uuid := coalesce(new.repair_order_id, old.repair_order_id);
begin
  if ro is not null then
    update public.repair_orders set edit_version = edit_version + 1 where id = ro;
  end if;
  return null;
end;
$$;

drop trigger if exists line_items_bump_ro_version on public.line_items;
create trigger line_items_bump_ro_version
  after insert or update or delete on public.line_items
  for each row execute function public.bump_ro_edit_version_from_child();

drop trigger if exists concern_lines_bump_ro_version on public.concern_lines;
create trigger concern_lines_bump_ro_version
  after insert or update or delete on public.concern_lines
  for each row execute function public.bump_ro_edit_version_from_child();

drop trigger if exists ro_techs_bump_ro_version on public.repair_order_technicians;
create trigger ro_techs_bump_ro_version
  after insert or update or delete on public.repair_order_technicians
  for each row execute function public.bump_ro_edit_version_from_child();
