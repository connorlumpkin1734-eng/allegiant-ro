-- Customer tapped "I sent it" on a Zelle payment → tell the shop to check the bank and confirm.
-- Goes to the RO's advisor(s) and the owner, like the paid alert.
create or replace function public.alert_on_zelle_sent()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_customer text;
begin
  if new.processor <> 'zelle' or new.status <> 'processing' or old.status = 'processing' then
    return new;
  end if;
  select nullif(trim(c.name), '') into v_customer
  from public.repair_orders ro left join public.customers c on c.id = ro.customer_id
  where ro.id = new.repair_order_id;

  perform public.create_alerts(new.repair_order_id,
    array(select distinct r from unnest(public.ro_advisor_recipients(new.repair_order_id) || new.owner_id) as r),
    'zelle_sent',
    coalesce(v_customer, 'The customer') || ' says they sent $' || to_char(new.amount, 'FM999,999,990.00')
      || ' by Zelle (' || public.alert_ro_label(new.repair_order_id) || ')',
    'Check your bank app, then open the RO and tap Confirm payment received.',
    'zelle_sent:' || new.id);
  return new;
end;
$$;

drop trigger if exists payments_alert_zelle_sent on public.payments;
create trigger payments_alert_zelle_sent after update of status on public.payments
  for each row execute function public.alert_on_zelle_sent();
