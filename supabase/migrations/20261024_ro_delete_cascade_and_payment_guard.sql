-- Fix: deleting an RO failed whenever it had line items ("violates foreign key constraint
-- line_items_repair_order_id_fkey"), because these child tables didn't cascade.
-- Now an RO's own records go with it when it's deleted.
--
-- Safety: an RO with any recorded payment can never be deleted (payments used to cascade-delete
-- silently, which would erase money records). Void or archive it instead.

alter table public.line_items drop constraint line_items_repair_order_id_fkey,
  add constraint line_items_repair_order_id_fkey foreign key (repair_order_id) references public.repair_orders(id) on delete cascade;
alter table public.multipoint_inspections drop constraint multipoint_inspections_repair_order_id_fkey,
  add constraint multipoint_inspections_repair_order_id_fkey foreign key (repair_order_id) references public.repair_orders(id) on delete cascade;
alter table public.estimate_photos drop constraint estimate_photos_repair_order_id_fkey,
  add constraint estimate_photos_repair_order_id_fkey foreign key (repair_order_id) references public.repair_orders(id) on delete cascade;
alter table public.estimate_authorizations drop constraint estimate_authorizations_repair_order_id_fkey,
  add constraint estimate_authorizations_repair_order_id_fkey foreign key (repair_order_id) references public.repair_orders(id) on delete cascade;
alter table public.estimate_videos drop constraint estimate_videos_repair_order_id_fkey,
  add constraint estimate_videos_repair_order_id_fkey foreign key (repair_order_id) references public.repair_orders(id) on delete cascade;
alter table public.video_share_links drop constraint video_share_links_repair_order_id_fkey,
  add constraint video_share_links_repair_order_id_fkey foreign key (repair_order_id) references public.repair_orders(id) on delete cascade;

create or replace function public.prevent_deleting_paid_repair_orders()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if exists (select 1 from public.payments p where p.repair_order_id = old.id) then
    raise exception 'This repair order has recorded payments and can''t be deleted. Void or archive it instead.';
  end if;
  return old;
end;
$$;
revoke execute on function public.prevent_deleting_paid_repair_orders() from public, anon, authenticated;

drop trigger if exists repair_orders_prevent_paid_delete on public.repair_orders;
create trigger repair_orders_prevent_paid_delete before delete on public.repair_orders
  for each row execute function public.prevent_deleting_paid_repair_orders();
