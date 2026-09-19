# Invoice override update

Apply `supabase/migrations/20260919_invoice_overrides.sql` in Supabase before deploying this change.

Add the extra work as a service job. Choose **Include on invoice**, confirm the override, and enter how the customer authorized it (for example, by text). Save Changes. The job now contributes to the invoice, dashboard total, and profit totals, and its separate authorization note prints on the invoice. The original estimate response and signature are preserved. A previously declined job can also be separately authorized; other declined jobs remain excluded.

For an already approved job, **Record additional authorization** records approval for changes. Saving a completed or paid invoice asks for confirmation before overriding it. Removing a job's override restores its original estimate decision. Authorization notes are customer-visible on the invoice.

Validation: `node --test tests/invoice-overrides.test.cjs` and `npm run build` (requires the two public Supabase environment variables).
