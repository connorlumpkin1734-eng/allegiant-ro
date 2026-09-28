// Receives Stripe webhook events. Two kinds matter here:
//  - `account.updated` (platform-level, sent for every connected account): keeps each shop's
//    stripe_onboarding_complete/charges_enabled/payouts_enabled flags in sync without the owner
//    needing to click "Refresh status".
//  - `checkout.session.completed` / `payment_intent.*` (connected-account events, forwarded to
//    the platform because they were created via the platform's API key with a Stripe-Account
//    header): mark the matching `payments` row and repair order as paid.
//
// Signature verification is done by hand (HMAC-SHA256 over "<timestamp>.<raw body>") rather than
// the stripe npm package, matching this codebase's pattern of calling Stripe/Supabase over plain
// fetch instead of pulling in SDKs.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

async function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string) {
  const parts = Object.fromEntries(signatureHeader.split(",").map((part) => part.split("=") as [string, string]));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signedPayload = `${timestamp}.${rawBody}`;
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expected = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  if (mismatch !== 0) return false;

  // Reject events older than 5 minutes to limit replay-attack exposure.
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  return ageSeconds <= 300;
}

type StripeEvent = {
  id: string;
  type: string;
  account?: string; // present on connected-account events forwarded to the platform
  data: { object: Record<string, unknown> };
};

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!supabaseUrl || !serviceKey || !webhookSecret) {
    return json({ error: "Stripe webhook is not configured on this deployment." }, 500);
  }

  const signatureHeader = request.headers.get("stripe-signature") || "";
  const rawBody = await request.text();
  const validSignature = signatureHeader ? await verifyStripeSignature(rawBody, signatureHeader, webhookSecret) : false;
  if (!validSignature) return json({ error: "Invalid signature." }, 400);

  const event = JSON.parse(rawBody) as StripeEvent;
  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  if (event.type === "account.updated") {
    const account = event.data.object as { id: string; details_submitted?: boolean; charges_enabled?: boolean; payouts_enabled?: boolean };
    await fetch(`${supabaseUrl}/rest/v1/settings?stripe_account_id=eq.${account.id}`, {
      method: "PATCH",
      headers: serviceHeaders,
      body: JSON.stringify({
        stripe_onboarding_complete: Boolean(account.details_submitted),
        stripe_charges_enabled: Boolean(account.charges_enabled),
        stripe_payouts_enabled: Boolean(account.payouts_enabled),
      }),
    });
    return json({ received: true });
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as { id: string; payment_intent?: string; payment_status?: string; metadata?: Record<string, string> };
    if (session.payment_status !== "paid") return json({ received: true });

    const paymentsResponse = await fetch(`${supabaseUrl}/rest/v1/payments?processor_session_id=eq.${session.id}&select=id,repair_order_id`, { headers: serviceHeaders });
    const payments = paymentsResponse.ok ? await paymentsResponse.json() as Array<{ id: string; repair_order_id: string }> : [];
    const payment = payments[0];
    if (!payment) return json({ received: true });

    await fetch(`${supabaseUrl}/rest/v1/payments?id=eq.${payment.id}`, {
      method: "PATCH", headers: serviceHeaders,
      body: JSON.stringify({ status: "succeeded", processor_payment_id: session.payment_intent || null }),
    });
    await fetch(`${supabaseUrl}/rest/v1/repair_orders?id=eq.${payment.repair_order_id}`, {
      method: "PATCH", headers: serviceHeaders,
      body: JSON.stringify({ paid: true, paid_at: new Date().toISOString() }),
    });
    return json({ received: true });
  }

  if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object as { id: string };
    await fetch(`${supabaseUrl}/rest/v1/payments?processor_session_id=eq.${session.id}`, {
      method: "PATCH", headers: serviceHeaders,
      body: JSON.stringify({ status: event.type === "checkout.session.expired" ? "canceled" : "failed" }),
    });
    return json({ received: true });
  }

  return json({ received: true });
};
