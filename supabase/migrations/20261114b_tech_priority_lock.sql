-- Technicians may set a line's priority only on their own recommendation (inspection) lines.
create or replace function public.protect_concern_lines_from_technicians()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if public.active_staff_role(new.owner_id) is distinct from 'technician' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.kind := 'inspection';
  else
    new.kind := old.kind;
    new.sort_order := old.sort_order;
    new.repair_order_id := old.repair_order_id;
    if old.kind <> 'inspection' then
      new.concern := old.concern;
      new.priority := old.priority;
    end if;
  end if;
  return new;
end;
$function$;
