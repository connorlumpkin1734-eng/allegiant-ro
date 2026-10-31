-- Job progress, "work complete", and alerts between techs and advisors.
--
-- * line_items.job_progress: where each job stands on the shop floor. Stored on every line of the
--   job, like job_status. To add a status later (e.g. waiting_parts), widen the check constraint
--   and add it to JOB_PROGRESS in app/page.tsx.
-- * repair_orders.work_complete_at/by: the tech says the car is done; reset when more work is approved.
-- * notifications: one row per person per alert, created only by the triggers below (never by the
--   browser). Each person can read and mark their own as read. Live updates via Supabase Realtime.
-- * user_preferences.email_alerts: per-person "email me these alerts" (off by default); a scheduled
--   Netlify function (alert-emails) sends them.

alter table public.line_items
  add column if not exists job_progress text not null default 'not_started';
alter table public.line_items drop constraint if exists line_items_job_progress_check;
alter table public.line_items add constraint line_items_job_progress_check
  check (job_progress in ('not_started', 'in_progress', 'done'));

alter table public.repair_orders
  add column if not exists work_complete_at timestamptz,
  add column if not exists work_complete_by uuid references auth.users(id) on delete set null;

alter table public.user_preferences
  add column if not exists email_alerts boolean not null default false;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  repair_order_id uuid references public.repair_orders(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  dedupe_key text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  emailed_at timestamptz
);
create unique index if not exists notifications_dedupe_idx on public.notifications (recipient_user_id, dedupe_key) where dedupe_key is not null;
create index if not exists notifications_recipient_idx on public.notifications (recipient_user_id, created_at desc);
create index if not exists notifications_repair_order_idx on public.notifications (repair_order_id);
create index if not exists notifications_owner_idx on public.notifications (owner_id);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.notifications to service_role;
drop policy if exists "People read their own alerts" on public.notifications;
create policy "People read their own alerts" on public.notifications for select
  using (recipient_user_id = (select auth.uid()));
drop policy if exists "People mark their own alerts read" on public.notifications;
create policy "People mark their own alerts read" on public.notifications for update
  using (recipient_user_id = (select auth.uid()))
  with check (recipient_user_id = (select auth.uid()));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ---- Who gets an alert -------------------------------------------------------------------------

-- The advisor on the RO; if none is assigned, every active advisor and admin plus the owner.
create or replace function public.ro_advisor_recipients(p_ro uuid)
returns uuid[] language sql stable security definer set search_path to 'public' as $$
  with ro as (select owner_id, service_advisor_id from public.repair_orders where id = p_ro),
  assigned as (
    select s.auth_user_id from public.staff s, ro
    where s.id = ro.service_advisor_id and s.active and s.auth_user_id is not null
  )
  select coalesce(
    (select array_agg(auth_user_id) from assigned),
    (select array_agg(distinct uid) from (
       select s.auth_user_id as uid from public.staff s, ro
       where s.owner_id = ro.owner_id and s.active and s.auth_user_id is not null
         and (s.role = 'service_advisor' or s.is_admin)
       union all
       select ro.owner_id from ro
     ) everyone),
    '{}'::uuid[]
  );
$$;

-- The techs dispatched to the RO; if none, the techs on its team.
create or replace function public.ro_tech_recipients(p_ro uuid)
returns uuid[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select array_agg(distinct s.auth_user_id)
       from public.repair_order_technicians rot join public.staff s on s.id = rot.staff_id
      where rot.repair_order_id = p_ro and s.active and s.auth_user_id is not null),
    (select array_agg(distinct s.auth_user_id)
       from public.repair_orders ro join public.staff s on s.team_id = ro.team_id and s.owner_id = ro.owner_id
      where ro.id = p_ro and ro.team_id is not null and s.active and s.role = 'technician' and s.auth_user_id is not null),
    '{}'::uuid[]
  );
$$;

-- Who did it, for the alert text ("Bobert finished…").
create or replace function public.alert_actor_name(p_owner uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select split_part(name, ' ', 1) from public.staff where owner_id = p_owner and auth_user_id = auth.uid() and active limit 1),
    case when auth.uid() = p_owner then 'The owner' end,
    'Someone'
  );
$$;

-- "RO #0021 · 2018 Lexus RX 350"
create or replace function public.alert_ro_label(p_ro uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select 'RO #' || lpad(ro.ro_number::text, 4, '0')
    || coalesce(' · ' || nullif(concat_ws(' ', v.year::text, v.make, v.model), ''), '')
  from public.repair_orders ro left join public.vehicles v on v.id = ro.vehicle_id
  where ro.id = p_ro;
$$;

create or replace function public.create_alerts(
  p_ro uuid, p_recipients uuid[], p_kind text, p_title text, p_body text, p_dedupe text
) returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_owner uuid;
begin
  select owner_id into v_owner from public.repair_orders where id = p_ro;
  if v_owner is null then return; end if;
  insert into public.notifications (owner_id, recipient_user_id, repair_order_id, kind, title, body, dedupe_key)
  select v_owner, r, p_ro, p_kind, p_title, p_body, p_dedupe
  from unnest(p_recipients) as r
  where r is not null and r is distinct from auth.uid()   -- never alert the person who did it
  on conflict do nothing;
end;
$$;

-- ---- Triggers that raise alerts ------------------------------------------------------------------

-- Tech marks the car work complete → advisor.
create or replace function public.alert_on_work_complete()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if old.work_complete_at is null and new.work_complete_at is not null then
    perform public.create_alerts(new.id, public.ro_advisor_recipients(new.id), 'work_complete',
      public.alert_actor_name(new.owner_id) || ' finished ' || public.alert_ro_label(new.id),
      'All approved work is done. Ready for you to review and invoice.',
      'complete:' || new.id || ':' || extract(epoch from new.work_complete_at)::bigint);
  end if;
  return new;
end;
$$;
drop trigger if exists repair_orders_alert_work_complete on public.repair_orders;
create trigger repair_orders_alert_work_complete after update of work_complete_at on public.repair_orders
  for each row execute function public.alert_on_work_complete();

-- Tech recommends a repair → advisor. Fires once per job (dedupe on the job id).
create or replace function public.alert_on_recommendation()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.job_status = 'pending_review' and new.service_group_id is not null then
    perform public.create_alerts(new.repair_order_id, public.ro_advisor_recipients(new.repair_order_id), 'recommendation',
      public.alert_actor_name(new.owner_id) || ' recommends ' || coalesce(nullif(trim(new.service_group_title), ''), 'a repair')
        || ' on ' || public.alert_ro_label(new.repair_order_id),
      'Price it and send it to the customer, or decline it.',
      'rec:' || new.service_group_id);
  end if;
  return new;
end;
$$;
drop trigger if exists line_items_alert_recommendation on public.line_items;
create trigger line_items_alert_recommendation after insert on public.line_items
  for each row execute function public.alert_on_recommendation();

-- Advisor reviews a tech's recommendation → techs. Approved means more work, so the car is no
-- longer "work complete".
create or replace function public.alert_on_recommendation_reviewed()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_title text := coalesce(nullif(trim(new.service_group_title), ''), 'Your recommendation');
begin
  if old.job_status = 'pending_review' and new.job_status in ('authorized', 'needs_approval') and new.service_group_id is not null then
    perform public.create_alerts(new.repair_order_id, public.ro_tech_recipients(new.repair_order_id), 'reviewed',
      case when new.job_status = 'authorized'
        then 'Go ahead: ' || v_title || ' is approved on ' || public.alert_ro_label(new.repair_order_id)
        else v_title || ' is priced and waiting on the customer (' || public.alert_ro_label(new.repair_order_id) || ')' end,
      null,
      'rev:' || new.service_group_id || ':' || new.job_status);
    if new.job_status = 'authorized' then
      update public.repair_orders set work_complete_at = null, work_complete_by = null
      where id = new.repair_order_id and work_complete_at is not null;
    end if;
  end if;
  -- A job reopened after being marked done means the car isn't finished after all.
  if old.job_progress = 'done' and new.job_progress <> 'done' then
    update public.repair_orders set work_complete_at = null, work_complete_by = null
    where id = new.repair_order_id and work_complete_at is not null;
  end if;
  return new;
end;
$$;
drop trigger if exists line_items_alert_reviewed on public.line_items;
create trigger line_items_alert_reviewed after update on public.line_items
  for each row execute function public.alert_on_recommendation_reviewed();

-- Customer answers the estimate → techs (go ahead on what was approved) and advisor.
create or replace function public.alert_on_customer_response()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_approved text;
  v_count int;
begin
  if old.status = 'sent' and new.status in ('approved', 'partially_approved', 'declined') then
    select count(*), string_agg(t.title, ', ' order by t.title)
      into v_count, v_approved
    from (
      select distinct li.service_group_id, coalesce(nullif(trim(li.service_group_title), ''), 'Service') as title
      from jsonb_each_text(coalesce(new.line_decisions, '{}'::jsonb)) d
      join public.line_items li on li.service_group_id::text = d.key and li.repair_order_id = new.repair_order_id
      where d.value = 'approved'
    ) t;

    perform public.create_alerts(new.repair_order_id, public.ro_advisor_recipients(new.repair_order_id), 'customer_response',
      case new.status
        when 'approved' then 'Customer approved the estimate on '
        when 'partially_approved' then 'Customer approved part of the estimate on '
        else 'Customer declined the estimate on ' end || public.alert_ro_label(new.repair_order_id),
      case when v_count > 0 then 'Approved: ' || v_approved else null end,
      'resp-adv:' || new.id);

    if v_count > 0 then
      perform public.create_alerts(new.repair_order_id, public.ro_tech_recipients(new.repair_order_id), 'approved',
        'Go ahead: customer approved ' || v_count || ' job' || case when v_count = 1 then '' else 's' end
          || ' on ' || public.alert_ro_label(new.repair_order_id),
        v_approved,
        'resp-tech:' || new.id);
      update public.repair_orders set work_complete_at = null, work_complete_by = null
      where id = new.repair_order_id and work_complete_at is not null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists estimate_authorizations_alert_response on public.estimate_authorizations;
create trigger estimate_authorizations_alert_response after update of status on public.estimate_authorizations
  for each row execute function public.alert_on_customer_response();

-- ---- "Work complete" (techs can't edit repair_orders directly) -----------------------------------
create or replace function public.mark_work_complete(p_ro uuid, p_complete boolean default true)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_owner uuid;
begin
  select owner_id into v_owner from public.repair_orders where id = p_ro;
  if v_owner is null then raise exception 'Repair order not found.'; end if;
  if not (
    auth.uid() = v_owner
    or public.active_staff_role(v_owner) = 'service_advisor'
    or public.staff_can_work_ro(p_ro)
  ) then
    raise exception 'You can''t update this repair order.';
  end if;
  if not public.owner_can_write(v_owner) then
    raise exception 'This shop is read-only right now.';
  end if;
  update public.repair_orders
     set work_complete_at = case when p_complete then now() else null end,
         work_complete_by = case when p_complete then auth.uid() else null end
   where id = p_ro;
end;
$$;

-- Internal helpers aren't callable from the browser; mark_work_complete is.
revoke execute on function public.ro_advisor_recipients(uuid) from public, anon, authenticated;
revoke execute on function public.ro_tech_recipients(uuid) from public, anon, authenticated;
revoke execute on function public.alert_actor_name(uuid) from public, anon, authenticated;
revoke execute on function public.alert_ro_label(uuid) from public, anon, authenticated;
revoke execute on function public.create_alerts(uuid, uuid[], text, text, text, text) from public, anon, authenticated;
revoke execute on function public.alert_on_work_complete() from public, anon, authenticated;
revoke execute on function public.alert_on_recommendation() from public, anon, authenticated;
revoke execute on function public.alert_on_recommendation_reviewed() from public, anon, authenticated;
revoke execute on function public.alert_on_customer_response() from public, anon, authenticated;
revoke execute on function public.mark_work_complete(uuid, boolean) from public, anon;
grant execute on function public.mark_work_complete(uuid, boolean) to authenticated;
