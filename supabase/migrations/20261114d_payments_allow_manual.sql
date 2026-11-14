-- Payments taken at the counter (cash, check, card on the shop's own terminal) are recorded by hand.
alter table public.payments drop constraint if exists payments_processor_check;
alter table public.payments add constraint payments_processor_check
  check (processor in ('stripe', 'zelle', 'square', 'manual'));
