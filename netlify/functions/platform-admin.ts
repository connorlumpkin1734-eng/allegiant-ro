// Cross-tenant admin actions for the platform operator's dedicated god-mode account only — not tied
// to any shop, not exposed via RLS to keep this out of the regular per-tenant policies entirely.
// Every call authenticates the caller, then checks whether THEIR OWN auth user id is listed in the
// standalone platform_admins table (never any shop's settings row) before doing anything cross-tenant.
// No shop owner or staff login, however privileged within their own shop, can ever reach this.
import { getStore } from "@netlify/blobs";
import { ensureSubscriptionProduct } from "../../lib/subscription-product";
import { fromAddress } from "../../lib/email-from";

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
  "settings", "teams", "customers", "vehicles", "repair_orders", "concern_lines", "line_items",
  "multipoint_inspections", "estimate_photos", "estimate_videos", "estimate_authorizations",
  "staff", "repair_order_technicians", "payments", "payment_links", "video_share_links",
  "platform_config", "platform_admins", "site_visits", "user_preferences",
] as const;

// Tables whose primary key isn't `id` (restore upserts match on the primary key).
const CONFLICT_COLUMN: Partial<Record<(typeof RESTORE_ORDER)[number], string>> = {
  user_preferences: "user_id",
};

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
    const priceCents = Math.round(body.planPriceCents);
    const shopResponse = await fetch(`${supabaseUrl}/rest/v1/settings?select=stripe_subscription_id,subscription_status,plan_price_cents,business_name,business_email&owner_id=eq.${body.ownerId}&limit=1`, { headers: serviceHeaders });
    const shop = (shopResponse.ok ? await shopResponse.json() as Array<{ stripe_subscription_id: string | null; subscription_status: string; plan_price_cents: number | null; business_name: string | null; business_email: string | null }> : [])[0];
    if (!shop) return json({ error: "Shop not found." }, 404);

    // A shop that's already subscribed: change what Stripe actually bills, starting with the next
    // invoice (no proration, no charge today). Stripe first, so the app never shows a price the
    // shop isn't really paying.
    let message = "Price updated. The shop pays this when it subscribes.";
    let currentPeriodEnd: string | null = null;
    if (shop.stripe_subscription_id && ["active", "past_due"].includes(shop.subscription_status)) {
      const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
      if (!stripeSecretKey) return json({ error: "Stripe isn't configured, so the price wasn't changed." }, 500);
      const stripeHeaders = { Authorization: `Bearer ${stripeSecretKey}` };
      const subscriptionResponse = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(shop.stripe_subscription_id)}`, { headers: stripeHeaders });
      const subscription = await subscriptionResponse.json() as {
        status?: string;
        items?: { data?: Array<{ id: string; price?: { product?: string; recurring?: { interval?: string } } }> };
        error?: { message?: string };
      };
      const item = subscription.items?.data?.[0];
      if (!subscriptionResponse.ok || !item) {
        return json({ error: `Couldn't load the shop's Stripe subscription, so the price wasn't changed. ${subscription.error?.message || ""}`.trim() }, 400);
      }
      if (subscription.status !== "canceled") {
        const update = new URLSearchParams({
          "items[0][id]": item.id,
          "items[0][price_data][currency]": "usd",
          // Always the permanent ROrunner product: the one Stripe made at checkout is inactive.
          "items[0][price_data][product]": await ensureSubscriptionProduct(stripeSecretKey),
          "items[0][price_data][unit_amount]": String(priceCents),
          "items[0][price_data][recurring][interval]": item.price?.recurring?.interval || "month",
          proration_behavior: "none",
        });
        const updateResponse = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(shop.stripe_subscription_id)}`, {
          method: "POST",
          headers: { ...stripeHeaders, "Content-Type": "application/x-www-form-urlencoded" },
          body: update,
        });
        const updated = await updateResponse.json().catch(() => ({})) as {
          error?: { message?: string }; current_period_end?: number; items?: { data?: Array<{ current_period_end?: number }> };
        };
        if (!updateResponse.ok) {
          return json({ error: `Stripe didn't accept the new price, so nothing changed. ${updated.error?.message || ""}`.trim() }, 400);
        }
        const periodEnd = updated.current_period_end ?? updated.items?.data?.[0]?.current_period_end;
        if (periodEnd) currentPeriodEnd = new Date(periodEnd * 1000).toISOString();
        message = "Price updated. Their Stripe subscription bills the new price from their next invoice.";
      }
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/settings?owner_id=eq.${body.ownerId}`, {
      method: "PATCH", headers: serviceHeaders,
      body: JSON.stringify({ plan_price_cents: priceCents, ...(currentPeriodEnd ? { subscription_current_period_end: currentPeriodEnd } : {}) }),
    });
    if (!response.ok) return json({ error: `Stripe was updated but the app's price wasn't: ${await response.text()}` }, 500);

    // A subscribed shop gets told about a price change before it's billed (the Terms promise this).
    const priceChanged = shop.plan_price_cents !== priceCents;
    const resendKey = process.env.RESEND_API_KEY;
    if (priceChanged && currentPeriodEnd && shop.business_email && resendKey) {
      const siteUrl = process.env.URL || new URL(request.url).origin;
      const dollars = (cents: number | null) => cents == null ? "" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
      const startDate = new Date(currentPeriodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
      const escapeHtml = (value: unknown) => String(value ?? "")
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
      const oldPrice = dollars(shop.plan_price_cents);
      const newPrice = dollars(priceCents);
      const shopName = shop.business_name || "your shop";
      const lower = shop.plan_price_cents != null && priceCents < shop.plan_price_cents;
      const settingsUrl = new URL("/#settings", siteUrl).toString();
      const html = `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e8f0">
<tr><td style="background:#102a4c;padding:22px 26px;color:#ffffff">
<img src="${escapeHtml(new URL("/rorunner-logo-white.png", siteUrl).toString())}" width="180" height="26" alt="ROrunner" style="display:block;border:0;width:180px;height:auto;max-width:180px">
<div style="font-size:22px;font-weight:700;margin-top:16px">${lower ? "Good news: your price is going down" : "A heads-up about your ROrunner price"}</div>
</td></tr>
<tr><td style="padding:24px 26px;color:#1b2333;font-size:15px;line-height:1.5">
<p style="margin:0 0 16px">The monthly price for <strong>${escapeHtml(shopName)}</strong>'s ROrunner subscription is changing.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:12px;background:#f3f8fb;margin-bottom:16px"><tr>
<td style="padding:16px;text-align:center"><div style="font-size:12px;color:#5b6578">Now</div><div style="font-size:22px;font-weight:700;color:#5b6578;text-decoration:line-through">${escapeHtml(oldPrice)}</div></td>
<td style="padding:16px;text-align:center;font-size:22px;color:#5b6578">→</td>
<td style="padding:16px;text-align:center"><div style="font-size:12px;color:#5b6578">Starting ${escapeHtml(startDate)}</div><div style="font-size:26px;font-weight:800;color:#102a4c">${escapeHtml(newPrice)}<span style="font-size:13px;color:#5b6578;font-weight:600">/month</span></div></td>
</tr></table>
<p style="margin:0 0 12px">The new price starts with your bill on <strong>${escapeHtml(startDate)}</strong>. Nothing changes for the month you've already paid for.</p>
<p style="margin:0 0 18px;padding:14px;border-radius:10px;background:#f7f9fc;font-size:13px;color:#5b6578">Still no contract, still month to month. If this doesn't work for you, you can cancel any time before then from <a href="${escapeHtml(settingsUrl)}" style="color:#0e7490">Settings → Payments &amp; billing</a>, and your data is always yours to download.</p>
<p style="margin:0;font-size:13px;color:#5b6578">Questions? Just reply to this email or write to support@rorunner.com.</p>
</td></tr></table>
</td></tr></table></body></html>`;
      const text = [
        `Your ROrunner price is changing: ${oldPrice}/month → ${newPrice}/month, starting with your bill on ${startDate}.`,
        "Nothing changes for the month you've already paid for.",
        "Still no contract, month to month. You can cancel any time before then in ROrunner under Settings → Payments & billing.",
        "Questions? Reply to this email or write to support@rorunner.com.",
      ].join("\n\n");
      try {
        const sent = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: fromAddress(`${process.env.EMAIL_PRODUCT_NAME || "ROrunner"} Billing`, "billing"),
            to: [shop.business_email],
            reply_to: "support@rorunner.com",
            subject: lower ? `Your ROrunner price is going down to ${newPrice}/month` : `Your ROrunner price is changing to ${newPrice}/month on ${startDate}`,
            html,
            text,
          }),
        });
        message += sent.ok ? ` ${shopName} was emailed about the change.` : " The notice email to the shop didn't send — let them know yourself.";
      } catch {
        message += " The notice email to the shop didn't send — let them know yourself.";
      }
    }
    return json({ message });
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
        const response = await fetch(`${supabaseUrl}/rest/v1/${table}?on_conflict=${CONFLICT_COLUMN[table] ?? "id"}`, {
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
