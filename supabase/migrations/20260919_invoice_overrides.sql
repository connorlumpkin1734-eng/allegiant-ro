-- Shop-recorded authorization is separate from the customer's signed snapshot.
-- Existing repair_orders owner RLS policies also protect this field.
alter table public.repair_orders
  add column if not exists invoice_overrides jsonb not null default '{}'::jsonb;
