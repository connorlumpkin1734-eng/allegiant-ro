type RepairOrderRow = {
  id: string;
  owner_id: string;
  ro_number: number;
  tax_rate: number;
  customers: { name: string; email: string | null } | null;
  vehicles: { year: number | null; make: string | null; model: string | null; vin: string | null } | null;
  line_items: Array<{ description: string; quantity: number; unit_price: number; taxable: boolean; sort_order: number; service_group_id: string | null; service_group_title: string | null }>;
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
  const fromEmail = process.env.ESTIMATE_FROM_EMAIL;
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
    `${supabaseUrl}/rest/v1/repair_orders?select=*,customers(name,email),vehicles(year,make,model,vin),line_items(description,quantity,unit_price,taxable,sort_order,service_group_id,service_group_title)&id=eq.${encodeURIComponent(body.repairOrderId)}&owner_id=eq.${user.id}`,
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
    items,
    photos,
    subtotal,
    tax,
    total,
    businessName: settings.business_name || "Allegiant Auto Care",
    businessPhone: settings.business_phone || "",
    businessEmail: settings.business_email || "",
  };

  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  const tokenHash = await hashToken(token);
  const approvalUrl = `${siteUrl.replace(/\/$/, "")}/estimate-approval/?token=${token}`;

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
      html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#102a4c"><h1>Allegiant Auto Care</h1><p>Hi ${escapeHtml(snapshot.customerName)},</p><p>Your estimate for the ${escapeHtml(snapshot.vehicle)} is ready.</p><div style="background:#f3f6fa;padding:18px;border-radius:10px;margin:22px 0"><strong>Estimate #${String(ro.ro_number).padStart(4, "0")}</strong><div style="font-size:28px;font-weight:800;margin-top:8px">${money(total)}</div></div><p><a href="${approvalUrl}" style="display:inline-block;background:#b21f2d;color:white;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:700">Review and approve estimate</a></p><p style="color:#64748b;font-size:13px">Please use the secure link to approve or decline. Additional repairs require separate authorization.</p></div>`,
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
