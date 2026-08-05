# Free Supabase backup setup

The app code is backed up by GitHub, but customer and RO data live in Supabase. This workflow creates a separate database backup every Sunday and also supports a manual backup button.

## One-time setup

1. In Supabase, open the project and click **Connect**.
2. Find the **Session pooler** connection string. Copy the URI form.
3. Replace the password placeholder in that URI with the database password you created for the Supabase project.
4. In GitHub, open the `allegiant-ro` repository.
5. Go to **Settings → Secrets and variables → Actions**.
6. Click **New repository secret**.
7. Name it exactly `SUPABASE_DB_URL`.
8. Paste the complete Supabase Session pooler URI as the value and save it.

Never place this connection string in a normal file or commit it to the repository.

## Test it immediately

1. Open **GitHub → Actions**.
2. Choose **Supabase database backup**.
3. Click **Run workflow**.
4. After it finishes, open that run and confirm an artifact named `allegiant-ro-database-...` appears.
5. Download one test artifact and keep it somewhere safe.

## What it does

- Runs every Sunday.
- Creates a PostgreSQL custom-format `.dump` containing schema and data.
- Stores it privately as a GitHub Actions artifact for 30 days.
- Can be run manually before any risky database change.

This is a useful free backup layer, but periodically download a backup to your own computer or cloud drive so you retain copies longer than the artifact window.
