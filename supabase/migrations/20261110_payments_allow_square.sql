-- Square payments are recorded in payments like Stripe and Zelle ones.
alter table public.payments drop constraint if exists payments_processor_check;
alter table public.payments add constraint payments_processor_check
  check (processor = any (array['stripe'::text, 'zelle'::text, 'square'::text]));
