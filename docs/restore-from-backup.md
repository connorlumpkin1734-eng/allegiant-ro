# Restoring from a nightly backup

Read this on the day something actually breaks — not before. This is a "break glass"
procedure on purpose: there's no one-click restore button in the app, because an
*accidental* restore is its own disaster. Every step below is something a human
deliberately chooses to do.

## When to actually use this

Use it when real data is missing or wrong — a bad migration, an accidental delete, a
bug that corrupted rows — **not** for "Supabase seems slow" or "the site is down."
A Supabase outage isn't a data-loss event; it resolves on its own and there's nothing
to restore. Restoring is for when the *data itself* is wrong, not when the *service*
is unavailable.

Before restoring anything, stop and check: is the data really gone, or did a filter/
search just make it look that way? Confirm in the Supabase table editor (or via a
direct SQL query) that rows are actually missing before touching backups.

## What's in a backup, and what restoring actually does

Every night at 09:00 UTC (~3–4am Central), the `nightly-backup` function snapshots
every table in the database — repair orders, customers, payments, settings, staff,
everything except `rate_limits` (a disposable counter table) — plus the list of
login accounts (Supabase Auth users). Up to 21 nightly snapshots are kept.

Restoring a snapshot is an **upsert**, not a wipe-and-replace:

- Any row that existed in the snapshot is written back exactly as it was then —
  this **overwrites** any changes made to that row since, including deleting it
  again if it was legitimately deleted on purpose after the snapshot.
- Any row created *after* the snapshot was taken is left alone (it's simply not in
  the snapshot, so nothing happens to it).
- **Login accounts are NOT automatically recreated.** If a staff or owner login was
  deleted after the snapshot, the restore will tell you its email was in the
  snapshot but is missing now — it stops there on purpose rather than guessing.
  Recreating a login from scratch (see below) gets a brand-new internal ID, which
  would silently break every record that still points at the old one. If this ever
  actually comes up, it needs a human to look at exactly what's missing and decide,
  not an automated guess.

In short: this is built for "a chunk of data got wiped or corrupted, put it back,"
not for "rebuild the entire platform from zero." The second case is rare enough
(it would mean losing the whole Supabase project, not just some rows) that it gets
its own careful, manual handling if that day ever comes — not a canned script.

## How to check what backups exist

As the platform admin (your god-mode login), call the `platform-admin` function:

```
POST /.netlify/functions/platform-admin
Authorization: Bearer <your admin session token>
Content-Type: application/json

{ "action": "list_backups" }
```

Returns every available snapshot, newest first, with its timestamp and a row count
per table — e.g. `{ "dateKey": "2026-10-03", "generatedAt": "...", "rowCounts": { "repair_orders": 6, ... }, "authUserCount": 4 }`.
`hadPartialFailures: true` on an entry means that night's backup didn't fully
succeed — treat that snapshot with extra caution and prefer an earlier one if one
exists.

The easiest way to actually make this call is to ask Claude to do it for you and
read back the list in plain English — you don't need to hand-craft the request
yourself.

## How to actually restore one

```
POST /.netlify/functions/platform-admin
Authorization: Bearer <your admin session token>
Content-Type: application/json

{ "action": "restore_backup", "dateKey": "2026-10-03", "confirm": true }
```

`confirm: true` is required — the call is rejected without it, as a guard against
firing this by accident. The response tells you exactly what happened:

- `restoredCounts` — how many rows were written back, per table
- `tableErrors` — present only if something failed partway through (the rest still
  completes; this isn't all-or-nothing)
- `missingAuthUsers` — present only if some login from the snapshot no longer
  exists. If you see this, stop and figure out why before doing anything else —
  don't just recreate the account and move on, since the old ID is gone for good
  and whatever referenced it needs to be checked by hand.

Again — the practical way to run this is to ask Claude to do it, describe what's
missing or wrong, and let it pick the right snapshot and walk through the result
with you, rather than crafting the HTTP call yourself.

## After restoring

Spot-check the specific thing that was broken (open the repair order, check the
customer record, whatever prompted this) to confirm it's actually back and correct.
Then check whether anything created *between* the snapshot and now needs to be
manually re-entered, since the restore doesn't touch or remove it, but it also
doesn't know it exists in relation to what was restored (e.g., a payment made
today against a repair order that just got reverted to last night's version).
