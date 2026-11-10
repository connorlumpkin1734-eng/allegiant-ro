-- RO numbers were one database-wide sequence, so a brand-new shop's first RO was #0023 (and
-- leaked how busy other shops were). Each shop now has its own counter on its settings row.
alter table public.settings add column if not exists next_ro_number integer not null default 1;
alter table public.settings drop constraint if exists settings_next_ro_number_positive;
alter table public.settings add constraint settings_next_ro_number_positive check (next_ro_number >= 1);

-- Existing shops carry on from their highest number.
update public.settings s
set next_ro_number = coalesce((select max(r.ro_number) from public.repair_orders r where r.owner_id = s.owner_id), 0) + 1;

-- Takes the shop's next number; the row lock on settings keeps two simultaneous ROs from sharing one.
create or replace function public.assign_shop_ro_number() returns trigger
language plpgsql security definer set search_path = public as $$
declare next_number integer;
begin
  update public.settings set next_ro_number = next_ro_number + 1
  where owner_id = new.owner_id
  returning next_ro_number - 1 into next_number;
  if next_number is null then
    -- No settings row yet: start this shop at 1.
    select coalesce(max(ro_number), 0) + 1 into next_number from public.repair_orders where owner_id = new.owner_id;
  end if;
  new.ro_number := next_number;
  return new;
end $$;
revoke all on function public.assign_shop_ro_number() from public, anon, authenticated;

drop trigger if exists repair_orders_assign_ro_number on public.repair_orders;
create trigger repair_orders_assign_ro_number
  before insert on public.repair_orders
  for each row execute function public.assign_shop_ro_number();

alter table public.repair_orders alter column ro_number drop default;
create unique index if not exists repair_orders_owner_ro_number_unique on public.repair_orders (owner_id, ro_number);
