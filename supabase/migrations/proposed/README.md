# Proposed migrations — NOT applied to any database

These two files showed up in the working folder on 2026-11-09 from another session. They have
not been run on staging or production. Review them, then apply on staging and move them up into
`supabase/migrations/` once they're live.

- `20261110_advisor_assign_scope.sql` — advisors can only assign/unassign techs on ROs they can see.
- `20261110_per_shop_ro_numbers.sql` — each shop gets its own RO counter (a new shop starts at #0001
  instead of continuing one database-wide sequence).
