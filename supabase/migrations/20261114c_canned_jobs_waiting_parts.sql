-- Canned jobs: saved jobs (name + labor/parts/fees) a shop drops onto an RO in one click.
-- ADDITIVE ONLY. Owner, admins and service advisors use and manage them. Technicians can't read
-- them: a canned job carries part costs, which techs never see.
create table if not exists public.canned_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists canned_jobs_owner_id_idx on public.canned_jobs (owner_id);
alter table public.canned_jobs enable row level security;
grant select, insert, update, delete on public.canned_jobs to authenticated, service_role;

drop policy if exists "Owners manage canned jobs" on public.canned_jobs;
create policy "Owners manage canned jobs" on public.canned_jobs for all
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and owner_can_write(owner_id));
drop policy if exists "Advisors and admins manage canned jobs" on public.canned_jobs;
create policy "Advisors and admins manage canned jobs" on public.canned_jobs for all
  using (active_staff_role(owner_id) = 'service_advisor' or staff_is_admin(owner_id))
  with check ((active_staff_role(owner_id) = 'service_advisor' or staff_is_admin(owner_id)) and owner_can_write(owner_id));

-- Waiting on parts: a fourth shop-floor progress value for a job.
alter table public.line_items drop constraint if exists line_items_job_progress_check;
alter table public.line_items add constraint line_items_job_progress_check
  check (job_progress = any (array['not_started', 'in_progress', 'waiting_parts', 'done']));
