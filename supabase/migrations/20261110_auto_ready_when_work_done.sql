-- When the last approved job on an open RO is marked Done, the RO moves to "Ready for advisor"
-- on its own (same as tapping Send to advisor — the advisor gets the usual alert). Reopening an
-- approved job, or approving another one, moves it back to In the shop.
create or replace function public.sync_work_complete_from_jobs() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ro_id uuid := coalesce(new.repair_order_id, old.repair_order_id);
  ro record;
  approved int;
  open_jobs int;
begin
  select id, status, paid, work_complete_at into ro from public.repair_orders where id = ro_id;
  if not found or ro.status <> 'open' or coalesce(ro.paid, false) then return null; end if;

  select count(*) filter (where job_status = 'authorized'),
         count(*) filter (where job_status = 'authorized' and coalesce(job_progress, 'not_started') <> 'done')
    into approved, open_jobs
  from public.line_items
  where repair_order_id = ro_id and service_group_id is not null;

  if approved > 0 and open_jobs = 0 and ro.work_complete_at is null then
    update public.repair_orders set work_complete_at = now(), work_complete_by = auth.uid() where id = ro_id;
  elsif open_jobs > 0 and ro.work_complete_at is not null then
    update public.repair_orders set work_complete_at = null, work_complete_by = null where id = ro_id;
  end if;
  return null;
end $$;
revoke all on function public.sync_work_complete_from_jobs() from public, anon, authenticated;

drop trigger if exists line_items_sync_work_complete on public.line_items;
create trigger line_items_sync_work_complete
  after insert or delete or update of job_progress, job_status on public.line_items
  for each row execute function public.sync_work_complete_from_jobs();
