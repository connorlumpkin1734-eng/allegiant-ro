// Receives Stripe webhook events. Three kinds matter here:
//  - `account.updated` (platform-level, sent for every connected account): keeps each shop's
//    stripe_onboarding_complete/charges_enabled/payouts_enabled flags in sync without the owner
//    needing to click "Refresh status".
//  - `checkout.session.completed` (mode "payment", connected-account event forwarded to the
//    platform because it was created via the platform's API key with a Stripe-Account header):
//    mark the matching `payments` row and repair order as paid. This is a shop collecting money
//    from ITS OWN customer.
//  - `checkout.session.completed` (mode "subscription") / `customer.subscription.updated` /
//    `customer.subscription.deleted` (platform-account events, no Stripe-Account header): these
//    are OUR platform billing a shop to use the software at all — see create-subscription-
//    checkout.ts. Distinguished from the payment-collection events above by `session.mode`.
//    `customer.subscription.updated` entering `past_due` also starts a 7-day read-only grace
//    period (settings.subscription_past_due_since — see migration
//    20261001_past_due_grace_period.sql and owner_can_write() in Postgres) and emails the owner a
//    one-time "update your payment method" notice with a live Billing Portal link. Recovering to
//    any other status clears the grace-period clock.
//
// This same webhook endpoint already receives platform-account events (account.updated), so no
// new endpoint or signing secret is needed for platform billing — just two more event types
// added to this endpoint's subscription in the Stripe dashboard: customer.subscription.updated
// and customer.subscription.deleted (checkout.session.completed is already subscribed).
//
// Signature verification is done by hand (HMAC-SHA256 over "<timestamp>.<raw body>") rather than
// the stripe npm package, matching this codebase's pattern of calling Stripe/Supabase over plain
// fetch instead of pulling in SDKs.

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

// Maps Stripe's subscription statuses onto our smaller settings.subscription_status enum
// (trialing/active/past_due/canceled/exempt). "exempt" is only ever set by us directly (Connor's
// own shop, or a manual comp via the platform-admin tool) and never overwritten here.
function mapSubscriptionStatus(stripeStatus: string): "active" | "past_due" | "canceled" | null {
  if (stripeStatus === "active" || stripeStatus === "trialing") return "active";
  if (stripeStatus === "past_due" || stripeStatus === "unpaid") return "past_due";
  if (stripeStatus === "canceled" || stripeStatus === "incomplete_expired") return "canceled";
  return null; // "incomplete" etc: not yet a real subscription, nothing to sync
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(request.url).origin;
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
    const session = event.data.object as {
      id: string;
      mode?: string;
      payment_intent?: string;
      payment_status?: string;
      customer?: string;
      subscription?: string;
      metadata?: Record<string, string>;
    };

    // Platform billing: a shop just subscribed to use the software (see
    // create-subscription-checkout.ts). Not a Connect-forwarded event — no Stripe-Account header
    // was used to create this session, so it always lands here as a plain platform event.
    if (session.mode === "subscription") {
      const ownerId = session.metadata?.owner_id;
      if (ownerId) {
        await fetch(`${supabaseUrl}/rest/v1/settings?owner_id=eq.${ownerId}`, {
          method: "PATCH", headers: serviceHeaders,
          body: JSON.stringify({
            subscription_status: "active",
            stripe_customer_id: session.customer || null,
            stripe_subscription_id: session.subscription || null,
          }),
        });
      }
      return json({ received: true });
    }

    // Otherwise: a shop collecting a card/ACH payment from ITS OWN customer via Stripe Connect.
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
    const session = event.data.object as { id: string; mode?: string };
    if (session.mode === "subscription") return json({ received: true }); // nothing recorded yet to roll back
    await fetch(`${supabaseUrl}/rest/v1/payments?processor_session_id=eq.${session.id}`, {
      method: "PATCH", headers: serviceHeaders,
      body: JSON.stringify({ status: event.type === "checkout.session.expired" ? "canceled" : "failed" }),
    });
    return json({ received: true });
  }

  // Platform billing subscription lifecycle (renewals, failed-card retries, cancellations). These
  // are keyed by Stripe customer id since a subscription event doesn't carry our owner_id metadata.
  if (event.type === "customer.subscription.updated") {
    const subscription = event.data.object as { id: string; customer: string; status: string; current_period_end?: number };
    const mapped = mapSubscriptionStatus(subscription.status);
    if (mapped) {
      const existingResponse = await fetch(
        `${supabaseUrl}/rest/v1/settings?select=owner_id,subscription_status,business_name,business_email&stripe_customer_id=eq.${subscription.customer}&subscription_status=neq.exempt&limit=1`,
        { headers: serviceHeaders }
      );
      const existing = (existingResponse.ok
        ? await existingResponse.json() as Array<{ owner_id: string; subscription_status: string; business_name: string | null; business_email: string | null }>
        : [])[0];

      // Start (or keep) a 7-day read-only grace period the first time we see past_due for this
      // episode; clear it the moment the status is anything else (recovered, or genuinely
      // canceled). Mirrors owner_can_write()'s grace-period check in Postgres — see migration
      // 20261001_past_due_grace_period.sql.
      const enteringPastDue = mapped === "past_due" && existing?.subscription_status !== "past_due";
      const patch: Record<string, unknown> = {
        subscription_status: mapped,
        stripe_subscription_id: subscription.id,
        subscription_current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
      };
      if (mapped === "past_due") {
        if (enteringPastDue) patch.subscription_past_due_since = new Date().toISOString();
      } else {
        patch.subscription_past_due_since = null;
      }

      await fetch(`${supabaseUrl}/rest/v1/settings?stripe_customer_id=eq.${subscription.customer}&subscription_status=neq.exempt`, {
        method: "PATCH", headers: serviceHeaders,
        body: JSON.stringify(patch),
      });

      // Dunning email: only on the moment we enter past_due (not every retry webhook while it
      // stays past_due), and only to the shop owner's own inbox.
      if (enteringPastDue && existing?.business_email && resendKey) {
        try {
          const businessName = existing.business_name || "your shop";
          let billingUrl = new URL("/", siteUrl).toString();
          if (stripeSecretKey) {
            const portalResponse = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
              method: "POST",
              headers: { Authorization: `Bearer ${stripeSecretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ customer: subscription.customer, return_url: new URL("/", siteUrl).toString() }),
            });
            const portal = await portalResponse.json() as { url?: string };
            if (portalResponse.ok && portal.url) billingUrl = portal.url;
          }
          const escapeHtml = (value: unknown) => String(value ?? "")
            .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: "Allegiant RO Billing <billing@allegiantautocare.com>",
              to: [existing.business_email],
              subject: `Action needed: your payment method failed`,
              text: `Hi,\n\nWe weren't able to charge the card on file for ${businessName}'s subscription. You have 7 days to update your payment method before the account goes read-only (existing work orders stay viewable, but creating or editing anything will pause).\n\nUpdate your payment method: ${billingUrl}\n\nIf you've already fixed this, you can ignore this email — we'll pick up the update automatically.`,
              html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#102a4c"><h2 style="margin-bottom:4px">Action needed: your payment method failed</h2><p>We weren't able to charge the card on file for <strong>${escapeHtml(businessName)}</strong>'s subscription.</p><p>You have <strong>7 days</strong> to update your payment method before the account goes read-only. Existing work orders stay viewable, but creating or editing anything will pause until it's fixed.</p><p><a href="${escapeHtml(billingUrl)}" style="display:inline-block;background:#2459a9;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700">Update payment method</a></p><p style="color:#64748b;font-size:13px">If you've already fixed this, you can ignore this email — we'll pick up the update automatically.</p></div>`,
            }),
          });
        } catch {
          // Best-effort — the status change and grace-period clock are already recorded either way.
        }
      }
    }
    return json({ received: true });
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as { customer: string };
    await fetch(`${supabaseUrl}/rest/v1/settings?stripe_customer_id=eq.${subscription.customer}&subscription_status=neq.exempt`, {
      method: "PATCH", headers: serviceHeaders,
      body: JSON.stringify({ subscription_status: "canceled", subscription_past_due_since: null }),
    });
    return json({ received: true });
  }

  return json({ received: true });
}

export default async (request: Request) => {
  try {
    return await handler(request);
  } catch (error) {
    await notifyError("stripe-webhook", error, request);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};
