-- Optional shop hours, shown in the footer of customer emails (estimate, invoice, inspection).
alter table public.settings add column if not exists business_hours text;
