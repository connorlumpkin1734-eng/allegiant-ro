-- Group labor, parts, and technician stories into customer-facing service jobs.
-- Safe to run more than once.

begin;

alter table public.line_items
  add column if not exists service_group_id uuid;

alter table public.line_items
  add column if not exists service_group_title text;

alter table public.line_items
  add column if not exists technician_story text;

create index if not exists line_items_service_group_idx
  on public.line_items(repair_order_id, service_group_id);

commit;
