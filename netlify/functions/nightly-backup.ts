// Runs automatically every night (see `config.schedule` below) and writes a full snapshot of the
// database to Netlify Blobs — this project is on Supabase's free plan, which has NO automated
// backups at all (daily backups are a paid Pro-plan feature, PITR is a separate paid add-on on top
// of that: https://supabase.com/docs/guides/platform/backups). Until the business is big enough to
// justify that cost, this is the safety net: if a bad migration, a bug, or a fat-fingered delete
// wipes data, we can restore from the most recent nightly snapshot instead of it being gone for good.
//
// Covers every `public` table (all app data: repair orders, customers, payments, etc.) PLUS the
// Supabase Auth user list (owners' and staffs' logins) via the admin API, since losing the data but
// keeping nobody able to log in isn't actually a recovery. `rate_limits` is skipped on purpose — it's
// a pure, self-regenerating counter table with zero value in a backup.
//
// Restoring from one of these snapshots is scripts/restore-backup.ts (run manually, not automated —
// restoring is a rare, deliberate action, not something that should ever happen by accident).
//
// Uses the same SUPABASE_SERVICE_ROLE_KEY already used by every other function here — no new
// credentials, no new third-party account. Storage is Netlify Blobs, which every Netlify site gets
// automatically with no setup.
import { getStore } from "@netlify/blobs";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

// Best-effort alert email to Connor when this function throws an uncaught exception. A backup job
// is exactly the kind of thing that can silently stop working for weeks with nobody noticing until
// the day it's actually needed — so unlike other functions, this one alerts on BOTH a hard crash
// and a soft failure (e.g. one table's export came back empty when it shouldn't have).
async function notifyError(functionName: string, error: unknown, request: Request) {
  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return;
    const detail = error instanceof Error ? `${error.message}\n\n${error.stack || ""}` : String(error);
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Allegiant RO Alerts <alerts@allegiantautocare.com>",
        to: ["connor.lumpkin1734@gmail.com"],
        subject: `[Allegiant RO] ${functionName} threw an error`,
        text: `${functionName} (${request.method} ${request.url}) threw an uncaught error:\n\n${detail}`,
      }),
    });
  } catch {
    // If Resend itself is down there's nothing more we can do here.
  }
}

// Every public table except rate_limits (ephemeral, self-regenerating, no backup value).
const TABLES = [
  "settings", "customers", "vehicles", "repair_orders", "line_items",
  "multipoint_inspections", "estimate_photos", "estimate_authorizations",
  "teams", "staff", "repair_order_technicians", "payments",
  "platform_config", "platform_admins", "site_visits",
] as const;

// How many nightly snapshots to keep around — at one a day this is ~3 weeks of history, which is
// already more generous than Supabase's own 7-day Pro-plan default, at effectively zero storage cost
// for a database this small. Old snapshots beyond this are deleted so the blob store doesn't grow
// forever.
const RETENTION_COUNT = 21;

// PostgREST caps each response at 1000 rows by default; page through with Range headers so this
// keeps working correctly as tables grow past that, not just today while everything is tiny.
async function fetchAllRows(supabaseUrl: string, serviceHeaders: Record<string, string>, table: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  const pageSize = 1000;
  let offset = 0;
  for (;;) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=*&order=id.asc`, {
      headers: { ...serviceHeaders, Range: `${offset}-${offset + pageSize - 1}` },
    });
    if (!response.ok) throw new Error(`Exporting ${table} failed (HTTP ${response.status}): ${await response.text()}`);
    const page = await response.json() as unknown[];
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

type AuthUser = { id: string; email?: string; created_at?: string; user_metadata?: Record<string, unknown> };

// Supabase Auth's admin list-users endpoint is paginated separately from PostgREST (page/per_page,
// not Range). We only need enough to recreate logins in a restore, not every internal auth field.
async function fetchAllAuthUsers(supabaseUrl: string, serviceHeaders: Record<string, string>): Promise<AuthUser[]> {
  const users: AuthUser[] = [];
  const perPage = 1000;
  let page = 1;
  for (;;) {
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, { headers: serviceHeaders });
    if (!response.ok) throw new Error(`Exporting auth users failed (HTTP ${response.status}): ${await response.text()}`);
    const body = await response.json() as { users?: AuthUser[] };
    const pageUsers = body.users ?? [];
    users.push(...pageUsers.map((u) => ({ id: u.id, email: u.email, created_at: u.created_at, user_metadata: u.user_metadata })));
    if (pageUsers.length < perPage) break;
    page += 1;
  }
  return users;
}

async function handler(request: Request): Promise<Response> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json({ error: "Backup configuration could not be loaded." }, 500);
  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  const tableData: Record<string, unknown[]> = {};
  const errors: string[] = [];
  for (const table of TABLES) {
    try {
      tableData[table] = await fetchAllRows(supabaseUrl, serviceHeaders, table);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  let authUsers: AuthUser[] = [];
  try {
    authUsers = await fetchAllAuthUsers(supabaseUrl, serviceHeaders);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  // If any single table (or the auth export) failed, still save what succeeded — a partial backup
  // beats no backup — but always alert, since a silently-partial nightly backup is worse than an
  // obvious outright failure (nobody would know to go check).
  if (errors.length) {
    await notifyError("nightly-backup (partial failure)", new Error(errors.join("\n")), request);
  }

  const snapshot = {
    generated_at: new Date().toISOString(),
    tables: tableData,
    auth_users: authUsers,
  };

  const rowCountsForMeta = Object.fromEntries(Object.entries(tableData).map(([table, rows]) => [table, rows.length]));
  const store = getStore("backups");
  const dateKey = snapshot.generated_at.slice(0, 10); // YYYY-MM-DD
  // Stash a lightweight summary as metadata so platform-admin's list_backups action can show what's
  // available without downloading every full snapshot just to render a list.
  await store.setJSON(`nightly/${dateKey}.json`, snapshot, {
    metadata: {
      generatedAt: snapshot.generated_at,
      rowCounts: rowCountsForMeta,
      authUserCount: authUsers.length,
      hadPartialFailures: errors.length > 0,
    },
  });

  // Prune anything past the retention window.
  const { blobs } = await store.list({ prefix: "nightly/" });
  const sorted = blobs.map((b) => b.key).sort().reverse(); // newest first, filenames sort lexically = chronologically
  const toDelete = sorted.slice(RETENTION_COUNT);
  await Promise.all(toDelete.map((key) => store.delete(key)));

  const rowCounts = Object.fromEntries(Object.entries(tableData).map(([table, rows]) => [table, rows.length]));
  return json({
    message: "Backup complete.",
    date: dateKey,
    rowCounts,
    authUserCount: authUsers.length,
    partialFailures: errors.length ? errors : undefined,
    pruned: toDelete.length,
  });
}

export default async (request: Request) => {
  try {
    return await handler(request);
  } catch (error) {
    await notifyError("nightly-backup", error, request);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};

// Runs once a day at 09:00 UTC (~3-4am Central, depending on DST) — quiet hours for a Dallas shop.
export const config = {
  schedule: "0 9 * * *",
};
