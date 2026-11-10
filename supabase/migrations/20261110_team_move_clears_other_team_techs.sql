-- When an RO moves to another team, techs from the old team come off it (the new team's lead
-- assigns from there). Techs with no team stay on; moving an RO to "no team" changes nothing.
create or replace function public.drop_other_team_techs_on_team_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.team_id is not null and new.team_id is distinct from old.team_id then
    delete from public.repair_order_technicians rot
    using public.staff s
    where rot.repair_order_id = new.id
      and s.id = rot.staff_id
      and s.team_id is not null
      and s.team_id <> new.team_id;
  end if;
  return new;
end $$;
revoke all on function public.drop_other_team_techs_on_team_change() from public, anon, authenticated;

drop trigger if exists repair_orders_team_change_drops_techs on public.repair_orders;
create trigger repair_orders_team_change_drops_techs
  after update of team_id on public.repair_orders
  for each row execute function public.drop_other_team_techs_on_team_change();
