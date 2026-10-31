// Every 5 minutes: email alerts (tech finished a car, tech recommends work, work approved) to people
// who turned on "Email me these alerts too" in the bell menu. Skips alerts already read in the app,
// and waits a couple of minutes first so someone working in the app isn't emailed about something
// they just saw. One email per person per run, listing their new alerts.

import { brandFromSettings, escapeHtml, paragraph, renderCustomerEmail, renderCustomerText } from "../../lib/customer-email";

type AlertRow = { id: string; owner_id: string; recipient_user_id: string; title: string; body: string | null; created_at: string };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

async function handler(): Promise<Response> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || "";
  if (!supabaseUrl || !serviceKey || !resendKey) return json({ error: "Alert emails are not configured." }, 500);
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  const newest = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const oldest = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  const alertsResponse = await fetch(
    `${supabaseUrl}/rest/v1/notifications?select=id,owner_id,recipient_user_id,title,body,created_at`
      + `&emailed_at=is.null&read_at=is.null&created_at=gte.${encodeURIComponent(oldest)}&created_at=lte.${encodeURIComponent(newest)}`
      + `&order=created_at.asc&limit=500`,
    { headers }
  );
  if (!alertsResponse.ok) return json({ error: `Could not load alerts: ${await alertsResponse.text()}` }, 500);
  const alerts = await alertsResponse.json() as AlertRow[];
  if (!alerts.length) return json({ sent: 0 });

  const recipients = [...new Set(alerts.map((alert) => alert.recipient_user_id))];
  const prefsResponse = await fetch(
    `${supabaseUrl}/rest/v1/user_preferences?select=user_id&email_alerts=eq.true&user_id=in.(${recipients.join(",")})`,
    { headers }
  );
  const optedIn = new Set((prefsResponse.ok ? await prefsResponse.json() as Array<{ user_id: string }> : []).map((row) => row.user_id));
  if (!optedIn.size) return json({ sent: 0 });

  // Email addresses: staff rows first, then the login itself (shop owners).
  const staffResponse = await fetch(
    `${supabaseUrl}/rest/v1/staff?select=auth_user_id,email,name&active=eq.true&auth_user_id=in.(${[...optedIn].join(",")})`,
    { headers }
  );
  const staffRows = staffResponse.ok ? await staffResponse.json() as Array<{ auth_user_id: string; email: string | null; name: string | null }> : [];
  const contact = new Map(staffRows.filter((row) => row.email).map((row) => [row.auth_user_id, { email: row.email as string, name: row.name ?? "" }]));
  for (const userId of optedIn) {
    if (contact.has(userId)) continue;
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, { headers });
    if (!userResponse.ok) continue;
    const user = await userResponse.json() as { email?: string };
    if (user.email) contact.set(userId, { email: user.email, name: "" });
  }

  const settingsCache = new Map<string, Record<string, unknown>>();
  const sentIds: string[] = [];
  let sent = 0;
  for (const userId of optedIn) {
    const person = contact.get(userId);
    const mine = alerts.filter((alert) => alert.recipient_user_id === userId);
    if (!person || !mine.length) continue;

    const ownerId = mine[0].owner_id;
    if (!settingsCache.has(ownerId)) {
      const settingsResponse = await fetch(`${supabaseUrl}/rest/v1/settings?select=*&owner_id=eq.${ownerId}&limit=1`, { headers });
      settingsCache.set(ownerId, (settingsResponse.ok ? await settingsResponse.json() as Array<Record<string, unknown>> : [])[0] || {});
    }
    const brand = brandFromSettings(settingsCache.get(ownerId) || {}, supabaseUrl);
    const firstName = person.name.trim().split(/\s+/)[0];
    const list = mine.map((alert) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:15px;color:#111827">
        <strong>${escapeHtml(alert.title)}</strong>${alert.body ? `<div style="margin-top:3px;font-size:13px;color:#6b7280">${escapeHtml(alert.body)}</div>` : ""}
      </td></tr>`).join("");
    const html = renderCustomerEmail({
      brand,
      preheader: mine[0].title,
      documentLabel: mine.length === 1 ? "New alert" : `${mine.length} new alerts`,
      vehicle: "",
      greeting: firstName ? `Hi ${firstName},` : "Hi,",
      intro: mine.length === 1 ? "Here&#039;s what just happened in the shop:" : "Here&#039;s what just happened in the shop:",
      body: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px">${list}</table>`
        + paragraph("You get these because you turned on email alerts. Turn them off in the bell menu in the app.", true),
      primaryButton: siteUrl ? { label: "Open the app", url: siteUrl } : undefined,
    });
    const text = renderCustomerText([
      firstName ? `Hi ${firstName},` : "Hi,",
      "",
      ...mine.map((alert) => `- ${alert.title}${alert.body ? ` (${alert.body})` : ""}`),
      "",
      siteUrl ? `Open the app: ${siteUrl}` : "",
      "You get these because you turned on email alerts. Turn them off in the bell menu in the app.",
    ], brand);

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${brand.name} <alerts@allegiantautocare.com>`,
        to: [person.email],
        subject: mine.length === 1 ? mine[0].title : `${mine.length} shop alerts: ${mine[0].title}`,
        text,
        html,
      }),
    });
    if (emailResponse.ok) {
      sent += 1;
      sentIds.push(...mine.map((alert) => alert.id));
    }
  }

  if (sentIds.length) {
    await fetch(`${supabaseUrl}/rest/v1/notifications?id=in.(${sentIds.join(",")})`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ emailed_at: new Date().toISOString() }),
    });
  }
  return json({ sent });
}

export default async () => {
  try {
    return await handler();
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Alert emails failed." }, 500);
  }
};

export const config = {
  schedule: "*/5 * * * *",
};
