// Public, unauthenticated endpoint behind the /pay-zelle page. GET returns the shop's Zelle info
// and amount due for a token; POST records that the customer says they've sent payment and emails
// the shop to go verify it in their own bank app. Nothing here ever marks an invoice paid — only
// confirm-zelle-payment.ts (staff-only) does that, after a human checks the money actually arrived.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

// Best-effort alert email to Connor when this function throws an uncaught exception — otherwise a
// bug or an upstream outage (Stripe/Supabase/Resend down) fails silently with nobody finding out
// until a shop or customer complains. Never lets the alert itself break the real response.
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


const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clientIp(request: Request): string {
  return request.headers.get("x-nf-client-connection-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

// Public endpoint, no login required — rate limit by IP so it can't be used to brute-force
// payment tokens or spam this function. Fails open (allows the request) if the rate limiter
// itself is unreachable, so an outage there never takes down real payment collection.
async function checkRateLimit(supabaseUrl: string, serviceKey: string, key: string, windowSeconds: number, maxRequests: number): Promise<boolean> {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/check_rate_limit`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_key: key, p_window_seconds: windowSeconds, p_max_requests: maxRequests }),
    });
    if (!response.ok) return true;
    return await response.json() as boolean;
  } catch {
    return true;
  }
}

type PaymentRow = {
  id: string;
  owner_id: string;
  repair_order_id: string;
  amount: string;
  status: string;
};

async function handler(request: Request): Promise<Response> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json({ error: "Payments configuration could not be loaded." }, 500);
  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  // GET (viewing the page) is capped generously; POST (claiming "I've sent payment") is tighter
  // since a legitimate customer only does it once per invoice.
  const ip = clientIp(request);
  const rateLimitKey = `pay-zelle:${request.method}:${ip}`;
  const allowed = request.method === "POST"
    ? await checkRateLimit(supabaseUrl, serviceKey, rateLimitKey, 600, 10)
    : await checkRateLimit(supabaseUrl, serviceKey, rateLimitKey, 600, 60);
  if (!allowed) return json({ error: "Too many requests — please wait a few minutes and try again." }, 429);

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
}

export default async (request: Request) => {
  try {
    return await handler(request);
  } catch (error) {
    await notifyError("pay-zelle", error, request);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};
