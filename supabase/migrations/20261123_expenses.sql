-- Expenses: shop overhead and parts purchases, imported from card statements (CSV) or added by hand.
-- ADDITIVE ONLY. Owner and admins only (same people who see Reports); technicians and advisors never read them.
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  expense_date date not null,
  description text not null default '',
  amount numeric(12,2) not null,            -- positive = money out; a refund kept on purpose is negative
  category text not null default 'Uncategorized',
  payment_method text not null default 'Card',
  repair_order_id uuid references public.repair_orders(id) on delete set null,
  notes text,
  source text not null default 'manual' check (source in ('manual', 'import')),
  import_key text,                          -- date|amount|description|n from the statement, stops double imports
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expenses_owner_date_idx on public.expenses (owner_id, expense_date desc);
create unique index if not exists expenses_owner_import_key_idx on public.expenses (owner_id, import_key) where import_key is not null;
alter table public.expenses enable row level security;
grant select, insert, update, delete on public.expenses to authenticated, service_role;

drop policy if exists "Owners manage expenses" on public.expenses;
create policy "Owners manage expenses" on public.expenses for all
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and owner_can_write(owner_id));
drop policy if exists "Admins manage expenses" on public.expenses;
create policy "Admins manage expenses" on public.expenses for all
  using (staff_is_admin(owner_id))
  with check (staff_is_admin(owner_id) and owner_can_write(owner_id));

-- Rules: "description contains X" -> category. Applied when a statement is imported.
create table if not exists public.expense_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  match_text text not null check (length(trim(match_text)) > 0),
  category text not null,
  created_at timestamptz not null default now()
);
create index if not exists expense_rules_owner_idx on public.expense_rules (owner_id);
alter table public.expense_rules enable row level security;
grant select, insert, update, delete on public.expense_rules to authenticated, service_role;

drop policy if exists "Owners manage expense rules" on public.expense_rules;
create policy "Owners manage expense rules" on public.expense_rules for all
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and owner_can_write(owner_id));
drop policy if exists "Admins manage expense rules" on public.expense_rules;
create policy "Admins manage expense rules" on public.expense_rules for all
  using (staff_is_admin(owner_id))
  with check (staff_is_admin(owner_id) and owner_can_write(owner_id));
