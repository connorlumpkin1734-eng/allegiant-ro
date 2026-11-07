-- A job the customer turned down (in person or by phone). Kept on the RO for the record, never billed.
alter table public.line_items drop constraint if exists line_items_job_status_check;
alter table public.line_items add constraint line_items_job_status_check
  check (job_status = any (array['authorized'::text, 'needs_approval'::text, 'pending_review'::text, 'declined'::text]));
