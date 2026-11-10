-- "You got paid" alert. Fires when a repair order flips to paid, however that happened: the Stripe
-- webhook (card / ACH), a confirmed Zelle payment, or someone marking it paid by hand. Goes to the
-- RO's advisor(s) and always to the owner; create_alerts already skips whoever did it.

create or replace function public.alert_on_paid()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_payment record;
  v_customer text;
  v_amount text;
  v_recipients uuid[];
begin
  if coalesce(old.paid, false) or not coalesce(new.paid, false) then
    return new;
  end if;

  select amount, processor, payment_method_type into v_payment
  from public.payments
  where repair_order_id = new.id and status in ('succeeded', 'processing')
  order by updated_at desc nulls last, created_at desc
  limit 1;

  select nullif(trim(name), '') into v_customer from public.customers where id = new.customer_id;

  v_amount := case when v_payment.amount is not null
    then ' · $' || to_char(v_payment.amount, 'FM999,999,990.00') else '' end;

  v_recipients := array(
    select distinct r from unnest(public.ro_advisor_recipients(new.id) || new.owner_id) as r
  );

  perform public.create_alerts(new.id, v_recipients, 'paid',
    'Paid: ' || public.alert_ro_label(new.id) || v_amount,
    coalesce(v_customer, 'The customer') || ' paid'
      || case
           when v_payment.processor = 'zelle' then ' by Zelle'
           when v_payment.payment_method_type = 'us_bank_account' then ' by bank transfer'
           when v_payment.payment_method_type = 'card' then ' by card'
           else ''
         end || '.',
    'paid:' || new.id || ':' || extract(epoch from coalesce(new.paid_at, now()))::bigint);
  return new;
end;
$$;

drop trigger if exists repair_orders_alert_paid on public.repair_orders;
create trigger repair_orders_alert_paid after update of paid on public.repair_orders
  for each row execute function public.alert_on_paid();
