-- Supabase stops auto-granting API access to new "public" tables on 2026-10-30
-- (this also applies to brand-new projects rebuilt from these migrations).
-- Record the API access every table needs explicitly, so a fresh copy of the
-- database (test environment, new production) works exactly like staging.
-- Row Level Security still decides which rows each user can actually see.
--
-- RULE FOR NEW TABLES: every migration that creates a table must include its own grants.

grant select, insert, update, delete on
  public.customers,
  public.estimate_authorizations,
  public.estimate_photos,
  public.estimate_videos,
  public.line_items,
  public.multipoint_inspections,
  public.payment_links,
  public.platform_admins,
  public.platform_config,
  public.rate_limits,
  public.repair_order_technicians,
  public.repair_orders,
  public.settings,
  public.site_visits,
  public.staff,
  public.teams,
  public.user_preferences,
  public.vehicles,
  public.video_share_links
to anon, authenticated, service_role;

-- Payments: signed-in users can read/record payments (RLS limits them to their shop);
-- anonymous visitors get no direct access.
grant select, insert, update on public.payments to authenticated;
grant select, insert, update, delete on public.payments to service_role;
