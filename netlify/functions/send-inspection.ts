// Emails a customer a read-only, shareable link to a completed multipoint inspection.
// Reuses the token-hash pattern from estimate_authorizations: a random token is generated here,
// only its SHA-256 hash is stored, and the public inspection-report page/function look the
// inspection up by that hash. The inspection itself can keep being edited afterward — sharing
// again reuses the same link unless the shop explicitly regenerates it.

import { brandFromSettings, escapeHtml, paragraph, renderCustomerEmail, renderCustomerText } from "../../lib/customer-email";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(request.url).origin;
  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", supabaseUrl],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publicKey],
    ["SUPABASE_SERVICE_ROLE_KEY", serviceKey],
    ["RESEND_API_KEY", resendKey],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    return json({ error: `Inspection email is missing Netlify variable${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.` }, 500);
  }
  if (!supabaseUrl || !publicKey || !serviceKey || !resendKey) {
    return json({ error: "Inspection email configuration could not be loaded." }, 500);
  }

  const authHeader = request.headers.get("authorization") || "";
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: authHeader },
  });
  if (!userResponse.ok) return json({ error: "Sign in again before sending an inspection." }, 401);
  const user = await userResponse.json() as { id: string };
  const body = await request.json().catch(() => ({})) as { repairOrderId?: string };
  if (!body.repairOrderId) return json({ error: "Missing repair order." }, 400);

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const roResponse = await fetch(
    `${supabaseUrl}/rest/v1/repair_orders?select=id,ro_number,customers(name,email),vehicles(year,make,model)&id=eq.${encodeURIComponent(body.repairOrderId)}&owner_id=eq.${user.id}`,
    { headers: serviceHeaders }
  );
  const roRows = await roResponse.json() as Array<{ id: string; ro_number: number; customers: { name: string; email: string | null } | null; vehicles: { year: number | null; make: string | null; model: string | null } | null }>;
  const ro = roRows[0];
  if (!ro) return json({ error: "Repair order not found." }, 404);
  const customerEmail = ro.customers?.email?.trim();
  if (!customerEmail) return json({ error: "Add the customer's email address before sending." }, 400);

  const inspectionResponse = await fetch(
    `${supabaseUrl}/rest/v1/multipoint_inspections?select=id,data,share_token_hash&repair_order_id=eq.${ro.id}&owner_id=eq.${user.id}&limit=1`,
    { headers: serviceHeaders }
  );
  const inspectionRows = await inspectionResponse.json() as Array<{ id: string; data: Record<string, unknown>; share_token_hash: string | null }>;
  const inspection = inspectionRows[0];
  if (!inspection || !inspection.data || Object.keys(inspection.data).length === 0) {
    return json({ error: "Save the inspection before sending it to the customer." }, 400);
  }

  const settingsResponse = await fetch(`${supabaseUrl}/rest/v1/settings?select=*&owner_id=eq.${user.id}&limit=1`, { headers: serviceHeaders });
  const settings = (settingsResponse.ok ? await settingsResponse.json() as Array<Record<string, unknown>> : [])[0] || {};
  const brand = brandFromSettings(settings, supabaseUrl);
  const businessName = brand.name;
  // Shared platform sending domain, tenant display name, Reply-To back to the shop — same
  // pattern used for invoices and estimates so every tenant isn't starting sender reputation
  // from zero, while replies still land with the actual shop.
  const fromEmail = `${businessName} <inspections@allegiantautocare.com>`;
  const replyToEmail = (settings.business_email as string) || undefined;

  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  const tokenHash = await hashToken(token);
  const now = new Date().toISOString();
  const updateResponse = await fetch(`${supabaseUrl}/rest/v1/multipoint_inspections?id=eq.${inspection.id}`, {
    method: "PATCH",
    headers: serviceHeaders,
    body: JSON.stringify({ share_token_hash: tokenHash, shared_at: now, shared_to_email: customerEmail }),
  });
  if (!updateResponse.ok) return json({ error: `Could not create a share link: ${await updateResponse.text()}` }, 500);

  const reportLink = new URL("/inspection-report/", siteUrl);
  reportLink.searchParams.set("token", token);
  const reportUrl = reportLink.toString();

  const roNumberLabel = `#${String(ro.ro_number).padStart(4, "0")}`;
  const vehicle = [ro.vehicles?.year, ro.vehicles?.make, ro.vehicles?.model].filter(Boolean).join(" ");
  const firstName = (ro.customers?.name || "").trim().split(/\s+/)[0] || "there";
  const vehicleText = vehicle || "vehicle";

  // Quick summary of the results: how many items need work, need watching, or are fine.
  const values = Object.values((inspection.data.items ?? {}) as Record<string, { status?: string }>);
  const count = (status: string) => values.filter((value) => value?.status === status).length;
  const needsWork = count("service");
  const watch = count("monitor");
  const good = count("good");
  const recommendations = String(inspection.data.recommendations ?? "").trim();
  const stat = (number: number, label: string, color: string, tint: string) => `<td width="33%" align="center" style="padding:14px 6px;background:${tint};border-radius:10px">
      <div style="font-family:Arial,sans-serif;font-size:28px;font-weight:800;color:${color}">${number}</div>
      <div style="font-family:Arial,sans-serif;font-size:12px;font-weight:700;color:${color}">${label}</div>
    </td>`;
  const summary = values.length
    ? `<table role="presentation" width="100%" cellspacing="6" cellpadding="0" border="0" style="margin:0 0 18px"><tr>
        ${stat(needsWork, "Needs attention", "#b91c1c", "#fef2f2")}
        ${stat(watch, "Keep an eye on", "#b45309", "#fffbeb")}
        ${stat(good, "Looks good", "#15803d", "#f0fdf4")}
      </tr></table>`
    : "";
  const recommendationBlock = recommendations
    ? paragraph(`<strong>Technician&#039;s notes:</strong> ${escapeHtml(recommendations.length > 400 ? `${recommendations.slice(0, 400).trimEnd()}…` : recommendations)}`)
    : "";
  const intro = needsWork
    ? `We gave your ${escapeHtml(vehicleText)} a full multipoint inspection and found ${needsWork === 1 ? "one thing" : `${needsWork} things`} that need attention. The full report has the details.`
    : watch
      ? `We gave your ${escapeHtml(vehicleText)} a full multipoint inspection. Nothing needs attention right now, but there ${watch === 1 ? "is one item" : `are ${watch} items`} we&#039;ll keep an eye on.`
      : `Good news: we gave your ${escapeHtml(vehicleText)} a full multipoint inspection and everything checked out.`;

  const html = renderCustomerEmail({
    brand,
    preheader: needsWork
      ? `${needsWork} ${needsWork === 1 ? "item needs" : "items need"} attention on your ${vehicleText}. See the full inspection.`
      : `Your ${vehicleText} inspection results are ready.`,
    documentLabel: `Inspection ${roNumberLabel}`,
    vehicle,
    greeting: `Hi ${firstName},`,
    intro,
    body: summary + recommendationBlock,
    primaryButton: { label: "View inspection report", url: reportUrl },
    fallbackUrl: reportUrl,
  });
  const text = renderCustomerText([
    `Hi ${firstName},`,
    "",
    `Your multipoint inspection for your ${vehicleText} (RO ${roNumberLabel}) is ready.`,
    values.length ? `Needs attention: ${needsWork} · Keep an eye on: ${watch} · Looks good: ${good}` : "",
    recommendations ? `\nTechnician's notes: ${recommendations}` : "",
    "",
    `View the full report: ${reportUrl}`,
  ], brand);

  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [customerEmail],
      ...(replyToEmail ? { reply_to: replyToEmail } : {}),
      subject: needsWork
        ? `Inspection results for your ${vehicleText}: ${needsWork} ${needsWork === 1 ? "item needs" : "items need"} attention`
        : `Inspection results for your ${vehicleText} from ${businessName}`,
      text,
      html,
    }),
  });
  if (!emailResponse.ok) {
    return json({ error: `Resend rejected the email: ${await emailResponse.text()}` }, 502);
  }

  return json({ message: `Inspection report emailed to ${customerEmail}.` });
};
