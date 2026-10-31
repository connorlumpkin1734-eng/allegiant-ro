// Emails a customer a read-only, shareable link to a completed multipoint inspection.
// Reuses the token-hash pattern from estimate_authorizations: a random token is generated here,
// only its SHA-256 hash is stored, and the public inspection-report page/function look the
// inspection up by that hash. The inspection itself can keep being edited afterward — sharing
// again reuses the same link unless the shop explicitly regenerates it.

import { brandFromSettings, escapeHtml, paragraph, renderCustomerEmail, renderCustomerText } from "../../lib/customer-email";
import { getInspectionShare, inspectionSummaryHtml } from "../../lib/inspection-share";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

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

  // Same link every time this inspection is sent, alone or with the estimate.
  let share;
  try {
    share = await getInspectionShare({ supabaseUrl, serviceHeaders, repairOrderId: ro.id, ownerId: user.id, siteUrl, customerEmail });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not create the inspection link." }, 500);
  }
  if (!share) return json({ error: "Save the inspection before sending it to the customer." }, 400);

  const settingsResponse = await fetch(`${supabaseUrl}/rest/v1/settings?select=*&owner_id=eq.${user.id}&limit=1`, { headers: serviceHeaders });
  const settings = (settingsResponse.ok ? await settingsResponse.json() as Array<Record<string, unknown>> : [])[0] || {};
  const brand = brandFromSettings(settings, supabaseUrl);
  const businessName = brand.name;
  // Shared platform sending domain, tenant display name, Reply-To back to the shop — same
  // pattern used for invoices and estimates so every tenant isn't starting sender reputation
  // from zero, while replies still land with the actual shop.
  const fromEmail = `${businessName} <inspections@allegiantautocare.com>`;
  const replyToEmail = (settings.business_email as string) || undefined;

  const reportUrl = share.url;

  const roNumberLabel = `#${String(ro.ro_number).padStart(4, "0")}`;
  const vehicle = [ro.vehicles?.year, ro.vehicles?.make, ro.vehicles?.model].filter(Boolean).join(" ");
  const firstName = (ro.customers?.name || "").trim().split(/\s+/)[0] || "there";
  const vehicleText = vehicle || "vehicle";

  const { needsWork, watch, recommendations } = share;
  const summary = inspectionSummaryHtml(share);
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
    summary ? `Needs attention: ${needsWork} · Keep an eye on: ${watch} · Looks good: ${share.good}` : "",
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
