-- Three kinds of concern line, dealer style:
--   request     "Customer requests oil and filter change"   (Concern + Correction; nothing to diagnose)
--   customer    "Customer states dragging noise"            (Concern + Cause + Correction)
--   inspection  "Technician recommends front brake pads"    (written by the tech; one line per finding)
--
-- Technicians: may create inspection lines and write their recommendation text, and Cause /
-- Correction on any line they work. They can never change a customer request/concern's text,
-- a line's kind, or line order.

alter table public.concern_lines drop constraint if exists concern_lines_kind_check;
alter table public.concern_lines add constraint concern_lines_kind_check
  check (kind in ('request', 'customer', 'inspection'));

create or replace function public.protect_concern_lines_from_technicians()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if public.active_staff_role(new.owner_id) is distinct from 'technician' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.kind := 'inspection';               -- techs only start their own recommendation lines
  else
    new.kind := old.kind;
    new.sort_order := old.sort_order;
    new.repair_order_id := old.repair_order_id;
    if old.kind <> 'inspection' then
      new.concern := old.concern;           -- the customer's words are the advisor's
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.protect_concern_lines_from_technicians() from public, anon, authenticated;
