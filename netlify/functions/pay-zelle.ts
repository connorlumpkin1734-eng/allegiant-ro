// Public, unauthenticated endpoint behind the /pay-zelle page. GET returns the shop's Zelle info
// and amount due for a token; POST records that the customer says they've sent payment and emails
// the shop to go verify it in their own bank app. Nothing here ever marks an invoice paid — only
// confirm-zelle-payment.ts (staff-only) does that, after a human checks the money actually arrived.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type PaymentRow = {
  id: string;
  owner_id: string;
  repair_order_id: string;
  amount: string;
  status: string;
};

export default async (request: Request) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json({ error: "Payments configuration could not be loaded." }, 500);
  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  const url = new URL(request.url);
  const token = request.method === "GET" ? url.searchParams.get("token") : (await request.json().catch(() => ({})) as { token?: string }).token;
  if (!token || token.length < 32) return json({ error: "This payment link is invalid." }, 400);
  const tokenHash = await hashToken(token);

  const paymentResponse = await fetch(
    `${supabaseUrl}/rest/v1/payments?select=id,owner_id,repair_order_id,amount,status&token_hash=eq.${tokenHash}&limit=1`,
    { headers: serviceHeaders }
  );
  const paymentRows = paymentResponse.ok ? await paymentResponse.json() as PaymentRow[] : [];
  const payment = paymentRows[0];
  if (!payment) return json({ error: "This payment link is invalid or has expired." }, 404);

  const [settingsResponse, roResponse] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/settings?select=business_name,zelle_recipient,business_email&owner_id=eq.${payment.owner_id}&limit=1`, { headers: serviceHeaders }),
    fetch(`${supabaseUrl}/rest/v1/repair_orders?select=ro_number,customers(name)&id=eq.${payment.repair_order_id}&limit=1`, { headers: serviceHeaders }),
  ]);
  const settings = (settingsResponse.ok ? await settingsResponse.json() as Array<{ business_name: string | null; zelle_recipient: string | null; business_email: string | null }> : [])[0];
  const ro = (roResponse.ok ? await roResponse.json() as Array<{ ro_number: number; customers: { name: string | null } | null }> : [])[0];

  if (request.method === "GET") {
    return json({
      businessName: settings?.business_name || "the shop",
      zelleRecipient: settings?.zelle_recipient || "",
      amount: payment.amount,
      roNumber: ro?.ro_number ?? null,
      alreadyPaid: payment.status === "succeeded",
      alreadyClaimed: payment.status === "processing",
    });
  }

  // POST: customer says they've sent the money. Only move pending -> processing — don't let a
  // repeated click, or a click after staff already confirmed, do anything surprising.
  if (payment.status !== "pending") {
    return json({ message: "Thanks — this payment has already been marked as sent." });
  }
  const updateResponse = await fetch(`${supabaseUrl}/rest/v1/payments?id=eq.${payment.id}`, {
    method: "PATCH",
    headers: serviceHeaders,
    body: JSON.stringify({ status: "processing" }),
  });
  if (!updateResponse.ok) return json({ error: `Could not record your payment: ${await updateResponse.text()}` }, 500);

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey && settings?.business_email) {
    try {
      const businessName = settings.business_name || "Allegiant Auto Care";
      const roLabel = ro?.ro_number ? `#${String(ro.ro_number).padStart(4, "0")}` : "";
      const customerName = ro?.customers?.name || "A customer";
      const amount = Number(payment.amount).toLocaleString("en-US", { style: "currency", currency: "usd" });
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${businessName} <notifications@allegiantautocare.com>`,
          to: [settings.business_email],
          subject: `Zelle payment claimed — Invoice ${roLabel}`,
          text: `${customerName} says they just sent ${amount} via Zelle for Invoice ${roLabel}.\n\nCheck your bank app to confirm the money actually arrived, then open this invoice in the app and click "Confirm payment received." Nothing is marked paid until you confirm it yourself.`,
          html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#102a4c"><h2 style="margin-bottom:4px">${escapeHtml(businessName)}</h2><p><strong>${escapeHtml(customerName)}</strong> says they just sent <strong>${escapeHtml(amount)}</strong> via Zelle for Invoice ${escapeHtml(roLabel)}.</p><p>Check your bank app to confirm the money actually arrived, then open this invoice and click <strong>"Confirm payment received."</strong></p><p style="color:#64748b;font-size:13px">Nothing is marked paid until you confirm it yourself.</p></div>`,
        }),
      });
    } catch {
      // Best-effort — the claim is still recorded even if the alert email fails.
    }
  }

  return json({ message: "Thanks! The shop has been notified and will confirm your payment shortly." });
};
