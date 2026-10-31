-- Keep the inspection's customer link so every send (on its own or with the estimate) reuses the
-- same link instead of replacing it. share_token_hash is still what the public report looks up.
-- Readable only by that shop's own users (existing row security), and it only opens that report.
alter table public.multipoint_inspections add column if not exists share_token text;
