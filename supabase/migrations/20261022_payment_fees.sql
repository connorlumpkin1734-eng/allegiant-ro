-- Record what Stripe charged to process each card/bank payment, so Reports can show money actually
-- deposited (collected minus fees) and the fees can be booked as a business expense.
-- Filled in by stripe-webhook.ts when a payment succeeds. Null = unknown (older payments, Zelle, cash).
alter table public.payments add column if not exists fee_amount numeric(12,2);
alter table public.payments add column if not exists net_amount numeric(12,2);
