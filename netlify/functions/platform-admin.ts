// Cross-tenant admin actions for the platform operator's dedicated god-mode account only — not tied
// to any shop, not exposed via RLS to keep this out of the regular per-tenant policies entirely.
// Every call authenticates the caller, then checks whether THEIR OWN auth user id is listed in the
// standalone platform_admins table (never any shop's settings row) before doing anything cross-tenant.
// No shop owner or staff login, however privileged within their own shop, can ever reach this.
import { getStore } from "@netlify/blobs";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

type Action =
  | { action: "list" }
  | { action: "update_price"; ownerId: string; planPriceCents: number }
  | { action: "update_status"; ownerId: string; status: "trialing" | "active" | "past_due" | "canceled" | "exempt" }
  | { action: "update_default_price"; defaultPlanPriceCents: number }
  | { action: "traffic" }
  | { action: "list_backups" }
  | { action: "restore_backup"; dateKey: string; confirm: boolean };

type BackupSnapshot = {
  generated_at: string;
  tables: Record<string, Array<Record<string, unknown>>>;
  auth_users: Array<{ id: string; email?: string; created_at?: string; user_metadata?: Record<string, unknown> }>;
};

// Same table list as nightly-backup.ts, in the order that's safe to restore: parents before the
// children that reference them (so a foreign key never points at a row that doesn't exist yet).
// rate_limits is skipped — same reasoning as the backup job, it's pure ephemeral state.
const RESTORE_ORDER = [
  "settings", "teams", "customers", "vehicles", "repair_orders", "line_items",
  "multipoint_inspections", "estimate_photos", "estimate_authorizations",
  "staff", "repair_order_technicians", "payments",
  "platform_config", "platform_admins", "site_visits",
] as const;

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !publicKey || !serviceKey) return json({ error: "Platform admin is not configured." }, 500);

  const authorization = request.headers.get("authorization") || "";
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json({ error: "Sign in again." }, 401);
  const user = await userResponse.json() as { id: string };

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  const callerResponse = await fetch(`${supabaseUrl}/rest/v1/platform_admins?select=id&id=eq.${user.id}&limit=1`, { headers: serviceHeaders });
  const callerRows = callerResponse.ok ? await callerResponse.json() as Array<{ id: string }> : [];
  if (!callerRows.length) return json({ error: "Not authorized." }, 403);

  const body = await request.json().catch(() => ({})) as Action;

  if (body.action === "list") {
    const [tenantsResponse, configResponse] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/settings?select=owner_id,business_name,business_email,subscription_status,plan_price_cents,trial_ro_limit,trial_ro_created_count,is_platform_admin,subscription_current_period_end,subscription_past_due_since&order=business_name.asc`,
        { headers: serviceHeaders }
      ),
      fetch(`${supabaseUrl}/rest/v1/platform_config?select=default_plan_price_cents&limit=1`, { headers: serviceHeaders }),
    ]);
    if (!tenantsResponse.ok) return json({ error: `Could not load shops: ${await tenantsResponse.text()}` }, 500);
    const tenants = await tenantsResponse.json();
    const config = configResponse.ok ? (await configResponse.json() as Array<{ default_plan_price_cents: number }>)[0] : null;
    return json({ tenants, defaultPlanPriceCents: config?.default_plan_price_cents ?? null });
  }

  if (body.action === "update_price") {
    if (!body.ownerId || !Number.isFinite(body.planPriceCents) || body.planPriceCents < 0) {
      return json({ error: "Missing or invalid shop/price." }, 400);
    }
    const response = await fetch(`${supabaseUrl}/rest/v1/settings?owner_id=eq.${body.ownerId}`, {
      method: "PATCH", headers: serviceHeaders, body: JSON.stringify({ plan_price_cents: Math.round(body.planPriceCents) }),
    });
    if (!response.ok) return json({ error: `Could not update price: ${await response.text()}` }, 500);
    return json({ message: "Price updated." });
  }

  if (body.action === "update_status") {
    const validStatuses = ["trialing", "active", "past_due", "canceled", "exempt"];
    if (!body.ownerId || !validStatuses.includes(body.status)) return json({ error: "Missing or invalid shop/status." }, 400);
    // Keep subscription_past_due_since in sync with a manual override too, same as the webhook
    // does for a real Stripe failure — otherwise owner_can_write()'s grace-period check (which
    // requires the timestamp to be set) would lock a manually-flagged shop out immediately instead
    // of giving it the same 7 days. See migration 20261001_past_due_grace_period.sql.
    const patch: Record<string, unknown> = { subscription_status: body.status };
    if (body.status === "past_due") patch.subscription_past_due_since = new Date().toISOString();
    else patch.subscription_past_due_since = null;
    const response = await fetch(`${supabaseUrl}/rest/v1/settings?owner_id=eq.${body.ownerId}`, {
      method: "PATCH", headers: serviceHeaders, body: JSON.stringify(patch),
    });
    if (!response.ok) return json({ error: `Could not update status: ${await response.text()}` }, 500);
    return json({ message: "Status updated." });
  }

  if (body.action === "update_default_price") {
    if (!Number.isFinite(body.defaultPlanPriceCents) || body.defaultPlanPriceCents < 0) return json({ error: "Invalid price." }, 400);
    const response = await fetch(`${supabaseUrl}/rest/v1/platform_config?id=eq.true`, {
      method: "PATCH", headers: serviceHeaders, body: JSON.stringify({ default_plan_price_cents: Math.round(body.defaultPlanPriceCents) }),
    });
    if (!response.ok) return json({ error: `Could not update default price: ${await response.text()}` }, 500);
    return json({ message: "Default price for new shops updated." });
  }

  if (body.action === "traffic") {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/site_visit_stats`, {
      method: "POST", headers: serviceHeaders, body: JSON.stringify({}),
    });
    if (!response.ok) return json({ error: `Could not load traffic: ${await response.text()}` }, 500);
    const rows = await response.json() as Array<{ total_visits: number; unique_visitors: number; daily: Array<{ date: string; visits: number; uniqueVisitors: number }> }>;
    const stats = rows[0] || { total_visits: 0, unique_visitors: 0, daily: [] };
    return json({ totalVisits: stats.total_visits, uniqueVisitors: stats.unique_visitors, daily: stats.daily });
  }

  if (body.action === "list_backups") {
    const store = getStore("backups");
    const { blobs } = await store.list({ prefix: "nightly/" });
    const backups = await Promise.all(blobs.map(async (blob) => {
      const result = await store.getMetadata(blob.key);
      const dateKey = blob.key.replace(/^nightly\//, "").replace(/\.json$/, "");
      return { dateKey, ...(result?.metadata || {}) };
    }));
    backups.sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1)); // newest first
    return json({ backups });
  }

  if (body.action === "restore_backup") {
    if (!body.dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(body.dateKey)) return json({ error: "Missing or invalid backup date." }, 400);
    if (body.confirm !== true) return json({ error: "Restore requires explicit confirmation." }, 400);

    const store = getStore("backups");
    const snapshot = await store.get(`nightly/${body.dateKey}.json`, { type: "json" }) as BackupSnapshot | null;
    if (!snapshot) return json({ error: `No backup found for ${body.dateKey}.` }, 404);

    // Upsert every table's rows back in (matched on primary key `id`), parents before children.
    // This is deliberately an upsert, not a wipe-then-insert: it restores/overwrites rows that
    // existed in the snapshot without touching anything created or changed since. Rows that were
    // deleted after the snapshot was taken come back; rows created after it was taken are untouched.
    const restoredCounts: Record<string, number> = {};
    const tableErrors: string[] = [];
    for (const table of RESTORE_ORDER) {
      const rows = snapshot.tables[table];
      if (!rows || !rows.length) continue;
      let restored = 0;
      for (let offset = 0; offset < rows.length; offset += 500) {
        const chunk = rows.slice(offset, offset + 500);
        const response = await fetch(`${supabaseUrl}/rest/v1/${table}?on_conflict=id`, {
          method: "POST",
          headers: { ...serviceHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(chunk),
        });
        if (!response.ok) {
          tableErrors.push(`${table}: ${await response.text()}`);
          break;
        }
        restored += chunk.length;
      }
      restoredCounts[table] = restored;
    }

    // Auth users are intentionally NOT auto-recreated here — a recreated user gets a brand-new id
    // from Supabase, which would silently break every settings.owner_id / staff.auth_user_id
    // reference pointing at the old one. Far safer to surface which logins from the snapshot no
    // longer exist and let a human decide (see the restore runbook) than to guess.
    const existingEmails = new Set<string>();
    let page = 1;
    for (;;) {
      const response = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: serviceHeaders });
      if (!response.ok) break;
      const pageBody = await response.json() as { users?: Array<{ email?: string }> };
      const pageUsers = pageBody.users ?? [];
      pageUsers.forEach((u) => { if (u.email) existingEmails.add(u.email.toLowerCase()); });
      if (pageUsers.length < 1000) break;
      page += 1;
    }
    const missingAuthUsers = snapshot.auth_users
      .filter((u) => u.email && !existingEmails.has(u.email.toLowerCase()))
      .map((u) => ({ email: u.email, id: u.id }));

    return json({
      message: "Restore complete.",
      backupGeneratedAt: snapshot.generated_at,
      restoredCounts,
      tableErrors: tableErrors.length ? tableErrors : undefined,
      missingAuthUsers: missingAuthUsers.length ? missingAuthUsers : undefined,
    });
  }

  return json({ error: "Unknown action." }, 400);
};
