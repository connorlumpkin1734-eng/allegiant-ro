-- Document footer: shops still on the original default footer (which hard-coded "Allegiant Auto Care"
-- and said "will be stated on the final invoice" on the invoice itself) move to the new default.
-- {shop} is replaced with the shop's name from Settings when documents print.
-- Footers a shop has customized are left alone.
update public.settings
set invoice_footer = 'Thank you for choosing {shop}. Payment is due upon completion of services. Please retain this document for your records.'
where invoice_footer = 'Thank you for choosing Allegiant Auto Care. Payment is due upon completion of services. Warranty coverage, when applicable, will be stated on the final invoice. Please retain this document for your records.';

-- New shops start with a blank name (the app prompts them to fill it in) instead of inheriting ours.
alter table public.settings alter column business_name set default '';
