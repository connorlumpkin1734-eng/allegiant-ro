-- Tracks whether a staff member is still on the temporary password they were
-- issued when their account was created. New accounts start flagged true;
-- the app forces a password-change screen (and won't let them into the rest
-- of the app) until it's cleared. Defaults to false so this never locks out
-- any staff account that already existed before this column was added.

alter table public.staff add column if not exists must_change_password boolean not null default false;
