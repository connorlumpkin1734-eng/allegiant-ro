alter table public.line_items
  add column if not exists work_performed text;

alter table public.line_items
  add column if not exists internal_notes text;
