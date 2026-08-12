# Allegiant Auto Care Repair Order System

A cloud-based repair order, estimate, and invoice app using Next.js, Netlify, and Supabase.

## Included in this first build

- Email/password login
- Customer and vehicle records
- NHTSA VIN decoding
- Estimates, repair orders, and invoices using the same RO number
- RO numbering displayed as 0001, 0002, and so on
- Labor lines with a default $100 hourly rate and per-line adjustment
- Part lines with cost, default 15% markup, calculated selling price, and manual override
- Manual fees, shop supplies, and discounts
- Adjustable tax rate and taxable setting per line
- Paid/unpaid status with paid date
- Search by customer, phone, email, VIN, plate, vehicle, or RO number
- Printable/PDF document layout
- In-app multipoint inspections saved to and recalled from each repair order
- Editable multipoint-inspection PDF export generated from saved inspection data

## Netlify environment variables

These must already exist in Netlify:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Never commit a Supabase secret key or service-role key.

## Deploy

1. Extract this ZIP.
2. Upload the contents of the extracted folder to the root of the GitHub repository connected to Netlify.
3. Commit the files to the main branch.
4. Netlify should automatically run `npm run build` and deploy the app.
5. Open the Netlify deploy log if the deployment fails.

## First account

After the app deploys, either:

- Use **Create the first account** on the login screen and confirm the email, or
- In Supabase go to **Authentication → Users → Add user**, create the owner account, and mark it confirmed.

For email confirmation links, set the deployed Netlify URL in Supabase under **Authentication → URL Configuration → Site URL**.

## Current database expectation

This app expects the `settings`, `customers`, `vehicles`, `repair_orders`, `line_items`, and `multipoint_inspections` tables. Run `RUN_THIS_IN_SUPABASE.sql` after deploying database-related updates.
