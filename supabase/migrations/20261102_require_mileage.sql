-- Shop setting: mileage in is required to open an RO, mileage out to close it.
alter table public.settings
  add column if not exists require_mileage boolean not null default false;

-- Odometer can't go backwards on a visit, whatever the setting.
alter table public.repair_orders
  drop constraint if exists repair_orders_mileage_out_not_below_in;
alter table public.repair_orders
  add constraint repair_orders_mileage_out_not_below_in
  check (mileage_in is null or mileage_out is null or mileage_out >= mileage_in);
