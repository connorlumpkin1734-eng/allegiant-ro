-- Performance: same security rules, faster evaluation.
-- 1) Wrap auth.uid() in (select ...) so Postgres evaluates it once per query instead of once per row.
-- 2) Add indexes for foreign keys flagged by the Supabase advisor.

alter policy "Owners delete their customers" on public.customers using (((owner_id = (SELECT auth.uid())) AND owner_can_write(owner_id)));
alter policy "Owners insert their customers" on public.customers with check (((owner_id = (SELECT auth.uid())) AND owner_can_write(owner_id)));
alter policy "Owners update their customers" on public.customers using ((owner_id = (SELECT auth.uid()))) with check (((owner_id = (SELECT auth.uid())) AND owner_can_write(owner_id)));
alter policy "Owners view their customers" on public.customers using ((owner_id = (SELECT auth.uid())));
alter policy "Owners can view estimate authorizations" on public.estimate_authorizations using (((SELECT auth.uid()) = owner_id));
alter policy "Owners can add estimate photos" on public.estimate_photos with check ((((SELECT auth.uid()) = owner_id) AND owner_can_write(owner_id)));
alter policy "Owners can delete estimate photos" on public.estimate_photos using ((((SELECT auth.uid()) = owner_id) AND owner_can_write(owner_id)));
alter policy "Owners can update estimate photos" on public.estimate_photos using (((SELECT auth.uid()) = owner_id)) with check ((((SELECT auth.uid()) = owner_id) AND owner_can_write(owner_id)));
alter policy "Owners can view estimate photos" on public.estimate_photos using (((SELECT auth.uid()) = owner_id));
alter policy "Owners can add estimate videos" on public.estimate_videos with check ((((SELECT auth.uid()) = owner_id) AND owner_can_write(owner_id)));
alter policy "Owners can delete estimate videos" on public.estimate_videos using ((((SELECT auth.uid()) = owner_id) AND owner_can_write(owner_id)));
alter policy "Owners can update estimate videos" on public.estimate_videos using (((SELECT auth.uid()) = owner_id)) with check ((((SELECT auth.uid()) = owner_id) AND owner_can_write(owner_id)));
alter policy "Owners can view estimate videos" on public.estimate_videos using (((SELECT auth.uid()) = owner_id));
alter policy "Owners delete their line items" on public.line_items using (((owner_id = (SELECT auth.uid())) AND owner_can_write(owner_id)));
alter policy "Owners insert their line items" on public.line_items with check (((owner_id = (SELECT auth.uid())) AND owner_can_write(owner_id)));
alter policy "Owners update their line items" on public.line_items using ((owner_id = (SELECT auth.uid()))) with check (((owner_id = (SELECT auth.uid())) AND owner_can_write(owner_id)));
alter policy "Owners view their line items" on public.line_items using ((owner_id = (SELECT auth.uid())));
alter policy "Owners can create multipoint inspections" on public.multipoint_inspections with check ((((SELECT auth.uid()) = owner_id) AND owner_can_write(owner_id) AND (EXISTS ( SELECT 1
   FROM repair_orders
  WHERE ((repair_orders.id = multipoint_inspections.repair_order_id) AND (repair_orders.owner_id = (SELECT auth.uid())))))));
alter policy "Owners can delete multipoint inspections" on public.multipoint_inspections using ((((SELECT auth.uid()) = owner_id) AND owner_can_write(owner_id)));
alter policy "Owners can update multipoint inspections" on public.multipoint_inspections using (((SELECT auth.uid()) = owner_id)) with check ((((SELECT auth.uid()) = owner_id) AND owner_can_write(owner_id) AND (EXISTS ( SELECT 1
   FROM repair_orders
  WHERE ((repair_orders.id = multipoint_inspections.repair_order_id) AND (repair_orders.owner_id = (SELECT auth.uid())))))));
alter policy "Owners can view multipoint inspections" on public.multipoint_inspections using (((SELECT auth.uid()) = owner_id));
alter policy "Owners manage their payments" on public.payments using ((owner_id = (SELECT auth.uid()))) with check ((owner_id = (SELECT auth.uid())));
alter policy "Platform admins can see themselves" on public.platform_admins using (((SELECT auth.uid()) = id));
alter policy "Owners delete RO technician assignments" on public.repair_order_technicians using (((owner_id = (SELECT auth.uid())) AND owner_can_write(owner_id)));
alter policy "Owners insert RO technician assignments" on public.repair_order_technicians with check (((owner_id = (SELECT auth.uid())) AND owner_can_write(owner_id)));
alter policy "Owners update RO technician assignments" on public.repair_order_technicians using ((owner_id = (SELECT auth.uid()))) with check (((owner_id = (SELECT auth.uid())) AND owner_can_write(owner_id)));
alter policy "Owners view RO technician assignments" on public.repair_order_technicians using ((owner_id = (SELECT auth.uid())));
alter policy "Owners delete their repair orders" on public.repair_orders using (((owner_id = (SELECT auth.uid())) AND owner_can_write(owner_id)));
alter policy "Owners insert their repair orders" on public.repair_orders with check (((owner_id = (SELECT auth.uid())) AND owner_can_write(owner_id)));
alter policy "Owners update their repair orders" on public.repair_orders using ((owner_id = (SELECT auth.uid()))) with check (((owner_id = (SELECT auth.uid())) AND owner_can_write(owner_id)));
alter policy "Owners view their repair orders" on public.repair_orders using ((owner_id = (SELECT auth.uid())));
alter policy "Users manage their settings" on public.settings using ((owner_id = (SELECT auth.uid()))) with check ((owner_id = (SELECT auth.uid())));
alter policy "Owners manage their staff" on public.staff using ((owner_id = (SELECT auth.uid()))) with check ((owner_id = (SELECT auth.uid())));
alter policy "Staff can view their own record" on public.staff using ((auth_user_id = (SELECT auth.uid())));
alter policy "Owners manage their teams" on public.teams using ((owner_id = (SELECT auth.uid()))) with check ((owner_id = (SELECT auth.uid())));
alter policy "Users manage their own preferences" on public.user_preferences using (((SELECT auth.uid()) = user_id)) with check (((SELECT auth.uid()) = user_id));
alter policy "Owners delete their vehicles" on public.vehicles using (((owner_id = (SELECT auth.uid())) AND owner_can_write(owner_id)));
alter policy "Owners insert their vehicles" on public.vehicles with check (((owner_id = (SELECT auth.uid())) AND owner_can_write(owner_id)));
alter policy "Owners update their vehicles" on public.vehicles using ((owner_id = (SELECT auth.uid()))) with check (((owner_id = (SELECT auth.uid())) AND owner_can_write(owner_id)));
alter policy "Owners view their vehicles" on public.vehicles using ((owner_id = (SELECT auth.uid())));

-- Foreign-key indexes
create index if not exists estimate_authorizations_repair_order_id_idx on public.estimate_authorizations (repair_order_id);
create index if not exists estimate_photos_owner_id_idx on public.estimate_photos (owner_id);
create index if not exists estimate_photos_repair_order_id_idx on public.estimate_photos (repair_order_id);
create index if not exists estimate_videos_owner_id_idx on public.estimate_videos (owner_id);
create index if not exists estimate_videos_repair_order_id_idx on public.estimate_videos (repair_order_id);
create index if not exists line_items_owner_id_idx on public.line_items (owner_id);
create index if not exists line_items_repair_order_id_idx on public.line_items (repair_order_id);
create index if not exists payments_confirmed_by_idx on public.payments (confirmed_by);
create index if not exists repair_order_technicians_owner_id_idx on public.repair_order_technicians (owner_id);
create index if not exists repair_orders_customer_id_idx on public.repair_orders (customer_id);
create index if not exists repair_orders_service_advisor_id_idx on public.repair_orders (service_advisor_id);
create index if not exists repair_orders_vehicle_id_idx on public.repair_orders (vehicle_id);
create index if not exists staff_team_id_idx on public.staff (team_id);
create index if not exists teams_owner_id_idx on public.teams (owner_id);
create index if not exists vehicles_customer_id_idx on public.vehicles (customer_id);
create index if not exists vehicles_owner_id_idx on public.vehicles (owner_id);
create index if not exists video_share_links_owner_id_idx on public.video_share_links (owner_id);
