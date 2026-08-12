# Multipoint inspection and archive update

Added:

- Service-job cards that keep labor, associated parts, and the technician story together.
- Technician stories print on customer estimates, work orders, and invoices.
- Discounts use a high-visibility savings treatment in the editor and printed documents.
- In-app multipoint inspection workspace linked to each saved repair order.
- Good, Monitor, Service, and N/A controls with measurements, notes, technician details, and final recommendations.
- Supabase save/recall for one editable inspection per RO.
- Editable branded PDF export generated from the saved inspection.
- Void and reopen repair orders from the dashboard or document screen.
- Large VOID watermark on voided documents and printed PDFs.
- Archive and restore repair orders.
- Archived ROs hidden by default with a Show archived toggle.
- Permanent RO deletion with confirmation; line items delete automatically.
- Archive and restore customers.
- Archived customers hidden from the normal customer directory and new-RO selector.
- Permanent customer deletion only when the customer has no ROs. Saved vehicles delete with the customer.
- Free scheduled/manual Supabase database backup workflow.
- Direct dependency versions pinned in package.json.

Before deploying, run RUN_THIS_IN_SUPABASE.sql in the Supabase SQL Editor.
