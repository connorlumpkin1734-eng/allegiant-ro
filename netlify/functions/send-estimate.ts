type RepairOrderRow = {
  id: string;
  owner_id: string;
  ro_number: number;
  tax_rate: number;
  created_at: string;
  customer_concern: string | null;
  customers: { name: string; email: string | null } | null;
  vehicles: { year: number | null; make: string | null; model: string | null; vin: string | null } | null;
  line_items: Array<{ description: string; quantity: number; unit_price: number; taxable: boolean; sort_order: number; service_group_id: string | null; service_group_title: string | null; technician_story: string | null }>;
};

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
  const fromEmail = "Allegiant Auto Care <estimates@allegiantautocare.com>";
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(request.url).origin;
  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", supabaseUrl],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publicKey],
    ["SUPABASE_SERVICE_ROLE_KEY", serviceKey],
    ["RESEND_API_KEY", resendKey],
    ["ESTIMATE_FROM_EMAIL", fromEmail],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    return json({ error: `Estimate email is missing Netlify variable${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.` }, 500);
  }
  if (!supabaseUrl || !publicKey || !serviceKey || !resendKey || !fromEmail) {
    return json({ error: "Estimate email configuration could not be loaded." }, 500);
  }

  const authorization = request.headers.get("authorization") || "";
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json({ error: "Sign in again before sending an estimate." }, 401);
  const user = await userResponse.json() as { id: string };
  const body = await request.json().catch(() => ({})) as { repairOrderId?: string };
  if (!body.repairOrderId) return json({ error: "Missing repair order." }, 400);

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const roResponse = await fetch(
    `${supabaseUrl}/rest/v1/repair_orders?select=*,customers(name,email),vehicles(year,make,model,vin),line_items(description,quantity,unit_price,taxable,sort_order,service_group_id,service_group_title,technician_story)&id=eq.${encodeURIComponent(body.repairOrderId)}&owner_id=eq.${user.id}`,
    { headers: serviceHeaders }
  );
  const rows = await roResponse.json() as RepairOrderRow[];
  const ro = rows[0];
  if (!ro) return json({ error: "Repair order not found." }, 404);
  const customerEmail = ro.customers?.email?.trim();
  if (!customerEmail) return json({ error: "Add the customer's email address before sending." }, 400);

  const settingsResponse = await fetch(`${supabaseUrl}/rest/v1/settings?select=*&owner_id=eq.${user.id}&limit=1`, { headers: serviceHeaders });
  const settings = (await settingsResponse.json() as Array<Record<string, unknown>>)[0] || {};
  const photoResponse = await fetch(`${supabaseUrl}/rest/v1/estimate_photos?select=service_group_id,storage_path,caption,sort_order&repair_order_id=eq.${ro.id}&order=sort_order.asc`, { headers: serviceHeaders });
  const photos = photoResponse.ok ? await photoResponse.json() as Array<Record<string, unknown>> : [];
  const items = [...(ro.line_items || [])].sort((a, b) => a.sort_order - b.sort_order);
  const subtotal = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price), 0);
  const taxable = items.reduce((sum, item) => sum + (item.taxable ? Number(item.quantity) * Number(item.unit_price) : 0), 0);
  const tax = Math.max(0, taxable) * (Number(ro.tax_rate) / 100);
  const total = subtotal + tax;
  const snapshot = {
    roNumber: ro.ro_number,
    customerName: ro.customers?.name || "Customer",
    customerEmail,
    vehicle: [ro.vehicles?.year, ro.vehicles?.make, ro.vehicles?.model].filter(Boolean).join(" "),
    vin: ro.vehicles?.vin || "",
    estimateDate: ro.created_at,
    customerConcern: ro.customer_concern || "",
    items,
    photos,
    subtotal,
    tax,
    total,
    taxRate: Number(ro.tax_rate),
    businessName: settings.business_name || "Allegiant Auto Care",
    businessAddress: settings.business_address || "",
    businessPhone: settings.business_phone || "",
    businessEmail: settings.business_email || "",
  };

  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  const tokenHash = await hashToken(token);
  const approvalLink = new URL("/estimate-approval/", siteUrl);
  approvalLink.searchParams.set("token", token);
  const approvalUrl = approvalLink.toString();

  await fetch(`${supabaseUrl}/rest/v1/estimate_authorizations?repair_order_id=eq.${ro.id}&status=eq.sent`, {
    method: "PATCH", headers: serviceHeaders, body: JSON.stringify({ status: "superseded" }),
  });
  const insertResponse = await fetch(`${supabaseUrl}/rest/v1/estimate_authorizations`, {
    method: "POST", headers: { ...serviceHeaders, Prefer: "return=representation" },
    body: JSON.stringify({ owner_id: user.id, repair_order_id: ro.id, token_hash: tokenHash, customer_email: customerEmail, estimate_snapshot: snapshot }),
  });
  if (!insertResponse.ok) return json({ error: `Could not create approval request: ${await insertResponse.text()}` }, 500);

  const money = (amount: number) => amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [customerEmail],
      subject: `Estimate #${String(ro.ro_number).padStart(4, "0")} from Allegiant Auto Care`,
      text: `Hi ${snapshot.customerName},\n\nYour estimate #${String(ro.ro_number).padStart(4, "0")} for ${snapshot.vehicle} is ready. Review it and approve or decline each service here:\n\n${approvalUrl}\n\nEstimated total: ${money(total)}\n\nAllegiant Auto Care`,
      html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#102a4c;border:1px solid #d9e0ea;border-radius:12px;overflow:hidden"><div style="padding:24px;border-bottom:5px solid #2459a9"><h1 style="margin:0">Allegiant Auto Care</h1><p style="margin:6px 0 0;color:#64748b">Estimate #${String(ro.ro_number).padStart(4, "0")} · ${escapeHtml(snapshot.vehicle)}</p></div><div style="padding:24px"><p>Hi ${escapeHtml(snapshot.customerName)},</p><p>Your itemized estimate is ready. You can approve or decline each recommended service separately.</p><div style="background:#edf4ff;border-left:6px solid #2459a9;padding:18px;margin:22px 0"><div style="font-size:12px;font-weight:700;text-transform:uppercase">Estimated total</div><div style="font-size:30px;font-weight:800;margin-top:5px">${money(total)}</div></div><table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:22px 0"><tr><td bgcolor="#b21f2d" style="border-radius:8px"><a href="${escapeHtml(approvalUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#b21f2d;color:#ffffff;text-decoration:none;padding:15px 22px;border-radius:8px;font-weight:700">Review estimate and choose services</a></td></tr></table><p style="color:#64748b;font-size:13px">If the button does not open, tap or copy this secure link:</p><p style="font-size:13px;line-height:1.5;overflow-wrap:anywhere;word-break:break-all"><a href="${escapeHtml(approvalUrl)}" target="_blank" rel="noopener noreferrer" style="color:#2459a9">${escapeHtml(approvalUrl)}</a></p><p style="color:#64748b;font-size:13px">The secure estimate includes the full itemization, repair photos, and signature authorization. Additional repairs require separate approval.</p></div></div>`,
    }),
  });
  if (!emailResponse.ok) {
    await fetch(`${supabaseUrl}/rest/v1/estimate_authorizations?token_hash=eq.${tokenHash}`, { method: "DELETE", headers: serviceHeaders });
    return json({ error: `Resend rejected the email: ${await emailResponse.text()}` }, 502);
  }

  const now = new Date().toISOString();
  await fetch(`${supabaseUrl}/rest/v1/repair_orders?id=eq.${ro.id}`, {
    method: "PATCH", headers: serviceHeaders, body: JSON.stringify({ estimate_status: "sent", estimate_sent_at: now, estimate_responded_at: null }),
  });
  return json({ message: `Estimate emailed to ${customerEmail}.` });
};
