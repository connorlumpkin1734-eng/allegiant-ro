// Emails a customer a read-only, shareable link to a completed multipoint inspection.
// Reuses the token-hash pattern from estimate_authorizations: a random token is generated here,
// only its SHA-256 hash is stored, and the public inspection-report page/function look the
// inspection up by that hash. The inspection itself can keep being edited afterward — sharing
// again reuses the same link unless the shop explicitly regenerates it.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

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
  const businessName = (settings.business_name as string) || "Allegiant Auto Care";
  const primaryColor = (settings.primary_color as string) || "#2459a9";
  const accentColor = (settings.accent_color as string) || "#b5222d";
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
  const customerName = ro.customers?.name || "there";

  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [customerEmail],
      ...(replyToEmail ? { reply_to: replyToEmail } : {}),
      subject: `Vehicle inspection report from ${businessName}`,
      text: `Hi ${customerName},\n\nYour multipoint inspection for ${vehicle} (RO ${roNumberLabel}) is ready to view:\n\n${reportUrl}\n\n${businessName}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#102a4c;border:1px solid #d9e0ea;border-radius:12px;overflow:hidden">
        <div style="padding:24px;border-bottom:5px solid ${escapeHtml(primaryColor)}"><h1 style="margin:0">${escapeHtml(businessName)}</h1><p style="margin:6px 0 0;color:#64748b">Inspection ${roNumberLabel} · ${escapeHtml(vehicle)}</p></div>
        <div style="padding:24px">
          <p>Hi ${escapeHtml(customerName)},</p>
          <p>We finished a full multipoint inspection on your vehicle. You can view the complete results, including anything that needs attention, at the link below.</p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:22px 0"><tr><td bgcolor="${escapeHtml(accentColor)}" style="border-radius:8px"><a href="${escapeHtml(reportUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:${escapeHtml(accentColor)};color:#ffffff;text-decoration:none;padding:15px 22px;border-radius:8px;font-weight:700">View inspection report</a></td></tr></table>
          <p style="color:#64748b;font-size:13px">If the button does not open, copy this link:</p>
          <p style="font-size:13px;line-height:1.5;overflow-wrap:anywhere;word-break:break-all"><a href="${escapeHtml(reportUrl)}" target="_blank" rel="noopener noreferrer" style="color:${escapeHtml(primaryColor)}">${escapeHtml(reportUrl)}</a></p>
        </div>
      </div>`,
    }),
  });
  if (!emailResponse.ok) {
    return json({ error: `Resend rejected the email: ${await emailResponse.text()}` }, 502);
  }

  return json({ message: `Inspection report emailed to ${customerEmail}.` });
};
