-- Adds a completed_at timestamp to repair_orders, automatically set by the
-- database whenever status transitions to 'completed', and cleared if the
-- status is ever moved away from 'completed'. This is set server-side via a
-- trigger so it stays correct no matter which code path changes status.

alter table public.repair_orders add column if not exists completed_at timestamptz;

create or replace function public.set_repair_order_completed_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and (old.status is distinct from 'completed') then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_repair_order_completed_at on public.repair_orders;
create trigger trg_set_repair_order_completed_at
before insert or update on public.repair_orders
for each row execute function public.set_repair_order_completed_at();
