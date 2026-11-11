import { notifyError } from "../../lib/platform-alert";
import { alertsFrom, fromAddress } from "../../lib/email-from";
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

// Fee, net and payment method for a payment on a shop's connected account. Returns {} if Stripe
// hasn't recorded the fee yet or the lookup fails; a failure here must never stop the invoice from
// being marked paid.
async function stripeFeeFields(paymentIntentId: string, connectedAccount: string, stripeSecretKey: string): Promise<Record<string, unknown>> {
  const fields: Record<string, unknown> = {};
  try {
    const headers = { Authorization: `Bearer ${stripeSecretKey}`, "Stripe-Account": connectedAccount };
    const intentResponse = await fetch(
      `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge.balance_transaction`,
      { headers }
    );
    if (!intentResponse.ok) return fields;
    type Balance = { fee?: number; net?: number };
    const intent = await intentResponse.json() as {
      latest_charge?: { payment_method_details?: { type?: string }; balance_transaction?: Balance | string | null } | string | null;
    };
    const charge = intent.latest_charge && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
    if (charge?.payment_method_details?.type) fields.payment_method_type = charge.payment_method_details.type;
    let balance: Balance | null = charge && charge.balance_transaction && typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;
    if (!balance && typeof charge?.balance_transaction === "string") {
      const balanceResponse = await fetch(`https://api.stripe.com/v1/balance_transactions/${encodeURIComponent(charge.balance_transaction)}`, { headers });
      if (balanceResponse.ok) balance = await balanceResponse.json() as Balance;
    }
    if (balance && typeof balance.fee === "number") {
      fields.fee_amount = balance.fee / 100;
      if (typeof balance.net === "number") fields.net_amount = balance.net / 100;
    }
  } catch {
    // Leave the fields unset.
  }
  return fields;
}

// Renewal date of a subscription. Newer Stripe API versions keep it on the subscription item rather
// than the subscription itself, so check both.
type StripeSubscription = {
  id: string; customer: string; status: string; current_period_end?: number;
  items?: { data?: Array<{ current_period_end?: number }> };
};
function periodEndIso(subscription: Pick<StripeSubscription, "current_period_end" | "items">) {
  const seconds = subscription.current_period_end ?? subscription.items?.data?.[0]?.current_period_end;
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Stripe sends a platform's events through two separate destinations, each with its own signing
  // secret: connected shops' events (STRIPE_WEBHOOK_SECRET) and ROrunner's own account events such
  // as shop subscriptions (STRIPE_PLATFORM_WEBHOOK_SECRET). Accept a signature from either.
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const platformWebhookSecret = process.env.STRIPE_PLATFORM_WEBHOOK_SECRET;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(request.url).origin;
  if (!supabaseUrl || !serviceKey || !webhookSecret) {
    return json({ error: "Stripe webhook is not configured on this deployment." }, 500);
  }

  const signatureHeader = request.headers.get("stripe-signature") || "";
  const rawBody = await request.text();
  let validSignature = false;
  for (const secret of [webhookSecret, platformWebhookSecret]) {
    if (secret && signatureHeader && await verifyStripeSignature(rawBody, signatureHeader, secret)) {
      validSignature = true;
      break;
    }
  }
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
        // Look up the new subscription for its first renewal date.
        let currentPeriodEnd: string | null = null;
        if (stripeSecretKey && session.subscription) {
          try {
            const subscriptionResponse = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(session.subscription)}`, {
              headers: { Authorization: `Bearer ${stripeSecretKey}` },
            });
            if (subscriptionResponse.ok) currentPeriodEnd = periodEndIso(await subscriptionResponse.json() as StripeSubscription);
          } catch {
            // The renewal date fills in on the next subscription update instead.
          }
        }
        await fetch(`${supabaseUrl}/rest/v1/settings?owner_id=eq.${ownerId}`, {
          method: "PATCH", headers: serviceHeaders,
          body: JSON.stringify({
            subscription_status: "active",
            stripe_customer_id: session.customer || null,
            stripe_subscription_id: session.subscription || null,
            ...(currentPeriodEnd ? { subscription_current_period_end: currentPeriodEnd } : {}),
          }),
        });
      }
      return json({ received: true });
    }

    // Otherwise: a shop collecting a card/ACH payment from ITS OWN customer via Stripe Connect.
    if (session.payment_status !== "paid") return json({ received: true });

    const paymentsResponse = await fetch(`${supabaseUrl}/rest/v1/payments?processor_session_id=eq.${session.id}&select=id,repair_order_id,processor_account_id`, { headers: serviceHeaders });
    const payments = paymentsResponse.ok ? await paymentsResponse.json() as Array<{ id: string; repair_order_id: string; processor_account_id: string | null }> : [];
    const payment = payments[0];
    if (!payment) return json({ received: true });

    // Best-effort: look up what Stripe charged to process this payment (fee and net) and which method
    // was used. A failure here must never stop the invoice from being marked paid.
    // Stripe often attaches the fee to the charge a moment after checkout completes, so give it a
    // few short tries.
    const feeFields: Record<string, unknown> = {};
    const connectedAccount = event.account || payment.processor_account_id;
    if (stripeSecretKey && connectedAccount && session.payment_intent) {
      for (let attempt = 0; attempt < 4 && feeFields.fee_amount === undefined; attempt++) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
        Object.assign(feeFields, await stripeFeeFields(session.payment_intent, connectedAccount, stripeSecretKey));
      }
    }

    await fetch(`${supabaseUrl}/rest/v1/payments?id=eq.${payment.id}`, {
      method: "PATCH", headers: serviceHeaders,
      body: JSON.stringify({ status: "succeeded", processor_payment_id: session.payment_intent || null, ...feeFields }),
    });
    await fetch(`${supabaseUrl}/rest/v1/repair_orders?id=eq.${payment.repair_order_id}`, {
      method: "PATCH", headers: serviceHeaders,
      body: JSON.stringify({ paid: true, paid_at: new Date().toISOString() }),
    });
    return json({ received: true });
  }

  // Backstop for the fee lookup above: Stripe sends charge.updated once the fee is attached. Only
  // fills a payment that's still missing its fee.
  if (event.type === "charge.updated") {
    const charge = event.data.object as { payment_intent?: string; balance_transaction?: string | null };
    const connectedAccount = event.account;
    if (!stripeSecretKey || !connectedAccount || !charge.payment_intent || !charge.balance_transaction) return json({ received: true });
    const feeFields = await stripeFeeFields(charge.payment_intent, connectedAccount, stripeSecretKey);
    if (feeFields.fee_amount !== undefined) {
      await fetch(`${supabaseUrl}/rest/v1/payments?processor_payment_id=eq.${encodeURIComponent(charge.payment_intent)}&fee_amount=is.null`, {
        method: "PATCH", headers: serviceHeaders, body: JSON.stringify(feeFields),
      });
    }
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
    const subscription = event.data.object as StripeSubscription;
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
        subscription_current_period_end: periodEndIso(subscription),
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
              from: fromAddress(`${process.env.EMAIL_PRODUCT_NAME || "ROrunner"} Billing`, "billing"),
              to: [existing.business_email],
              subject: `Action needed: your payment method failed`,
              text: `Hi,\n\nWe weren't able to charge the card on file for ${businessName}'s subscription. You have 7 days to update your payment method before the account goes read-only (existing repair orders stay viewable, but creating or editing anything will pause).\n\nUpdate your payment method: ${billingUrl}\n\nIf you've already fixed this, you can ignore this email — we'll pick up the update automatically.`,
              html: `<!doctype html><html><head><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>:root{color-scheme:light dark;supported-color-schemes:light dark}</style></head><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e8f0">
<tr><td bgcolor="#102a4c" style="background-color:#102a4c;background-image:linear-gradient(#102a4c,#102a4c);padding:22px 26px;color:#ffffff">
<img src="${escapeHtml(new URL("/rorunner-logo-white.png", siteUrl).toString())}" width="180" height="26" alt="ROrunner" style="display:block;border:0;width:180px;height:auto;max-width:180px">
<div style="font-size:22px;font-weight:700;margin-top:16px">Action needed: your payment didn't go through</div>
</td></tr>
<tr><td style="padding:24px 26px;color:#1b2333;font-size:15px;line-height:1.5">
<p style="margin:0 0 12px">We weren't able to charge the card on file for <strong>${escapeHtml(businessName)}</strong>'s ROrunner subscription.</p>
<p style="margin:0 0 18px">You have <strong>7 days</strong> to update your payment method before the account goes read-only. Your repair orders stay viewable, but creating or editing anything pauses until it's fixed.</p>
<p style="margin:0 0 18px"><a href="${escapeHtml(billingUrl)}" style="display:inline-block;background:#22d3ee;color:#04222a;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700">Update payment method</a></p>
<p style="margin:0;font-size:13px;color:#5b6578">Already fixed it? You can ignore this email; we'll pick up the update automatically. Questions? Reply here or write to support@rorunner.com.</p>
</td></tr></table>
</td></tr></table></body></html>`,
            }),
          });
        } catch {
          // Best-effort — the status change and grace-period clock are already recorded either way.
        }
      }
    }
    return json({ received: true });
  }

  // ROrunner subscription receipt: every paid subscription invoice (first month and each renewal)
  // gets a branded receipt emailed to the shop, with Stripe's invoice/receipt links.
  if (event.type === "invoice.paid") {
    const invoice = event.data.object as {
      id: string; customer?: string; customer_email?: string | null; number?: string | null;
      amount_paid?: number; currency?: string; created?: number; billing_reason?: string;
      hosted_invoice_url?: string | null; invoice_pdf?: string | null;
      subscription?: string | null; parent?: { subscription_details?: { subscription?: string } | null } | null;
      lines?: { data?: Array<{ period?: { start?: number; end?: number } }> };
    };
    const isSubscription = Boolean(invoice.subscription || invoice.parent?.subscription_details?.subscription || invoice.billing_reason?.startsWith("subscription"));
    if (!isSubscription || !invoice.customer || !invoice.amount_paid || !resendKey) return json({ received: true });

    const shopResponse = await fetch(
      `${supabaseUrl}/rest/v1/settings?select=business_name,business_email,plan_price_cents&stripe_customer_id=eq.${encodeURIComponent(invoice.customer)}&limit=1`,
      { headers: serviceHeaders }
    );
    const shop = (shopResponse.ok ? await shopResponse.json() as Array<{ business_name: string | null; business_email: string | null }> : [])[0];
    const to = shop?.business_email || invoice.customer_email;
    if (!to) return json({ received: true });

    const escapeHtml = (value: unknown) => String(value ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
    const money = ((invoice.amount_paid || 0) / 100).toLocaleString("en-US", { style: "currency", currency: (invoice.currency || "usd").toUpperCase() });
    const day = (seconds?: number) => seconds ? new Date(seconds * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" }) : "";
    const period = invoice.lines?.data?.[0]?.period;
    const periodText = period?.start && period?.end ? `${day(period.start)} – ${day(period.end)}` : "";
    const shopName = shop?.business_name || "your shop";
    const settingsUrl = new URL("/#settings", siteUrl).toString();
    const row = (label: string, value: string) => value
      ? `<tr><td style="padding:8px 0;color:#5b6578;font-size:14px">${escapeHtml(label)}</td><td style="padding:8px 0;text-align:right;font-size:14px;color:#102a4c;font-weight:600">${escapeHtml(value)}</td></tr>`
      : "";
    const html = `<!doctype html><html><head><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>:root{color-scheme:light dark;supported-color-schemes:light dark}</style></head><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e8f0">
<tr><td bgcolor="#102a4c" style="background-color:#102a4c;background-image:linear-gradient(#102a4c,#102a4c);padding:22px 26px;color:#ffffff">
<img src="${escapeHtml(new URL("/rorunner-logo-white.png", siteUrl).toString())}" width="180" height="26" alt="ROrunner" style="display:block;border:0;width:180px;height:auto;max-width:180px">
<div style="font-size:22px;font-weight:700;margin-top:16px">Payment received — thank you!</div>
</td></tr>
<tr><td style="padding:24px 26px">
<p style="margin:0 0 16px;font-size:15px;color:#1b2333">Here's your receipt for <strong>${escapeHtml(shopName)}</strong>'s ROrunner subscription.</p>
<div style="text-align:center;padding:18px;border-radius:12px;background:#f3f8fb;margin-bottom:16px">
<div style="font-size:13px;color:#5b6578">Amount paid</div>
<div style="font-size:34px;font-weight:800;color:#102a4c;margin-top:4px">${escapeHtml(money)}</div>
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e3e8f0">
${row("Date", day(invoice.created))}${row("Service period", periodText)}${row("Receipt number", invoice.number || "")}${row("Plan", "ROrunner, month to month")}
</table>
${invoice.hosted_invoice_url || invoice.invoice_pdf ? `<p style="margin:18px 0 0;font-size:14px">${invoice.hosted_invoice_url ? `<a href="${escapeHtml(invoice.hosted_invoice_url)}" style="color:#0e7490;font-weight:600">View receipt online</a>` : ""}${invoice.hosted_invoice_url && invoice.invoice_pdf ? " &nbsp;·&nbsp; " : ""}${invoice.invoice_pdf ? `<a href="${escapeHtml(invoice.invoice_pdf)}" style="color:#0e7490;font-weight:600">Download PDF</a>` : ""}</p>` : ""}
<p style="margin:20px 0 0;padding:14px;border-radius:10px;background:#f7f9fc;font-size:13px;color:#5b6578;line-height:1.5">
No contract, month to month. Update your card or cancel any time from <a href="${escapeHtml(settingsUrl)}" style="color:#0e7490">Settings → Payments &amp; billing</a> in ROrunner. Your data is always yours to download.
</p>
<p style="margin:16px 0 0;font-size:13px;color:#5b6578">Questions? Just reply to this email or write to support@rorunner.com.</p>
</td></tr></table>
</td></tr></table></body></html>`;
    const text = [
      "ROrunner: payment received, thank you!",
      "",
      `Receipt for ${shopName}'s ROrunner subscription.`,
      `Amount paid: ${money}`,
      invoice.created ? `Date: ${day(invoice.created)}` : "",
      periodText ? `Service period: ${periodText}` : "",
      invoice.number ? `Receipt number: ${invoice.number}` : "",
      invoice.hosted_invoice_url ? `View receipt: ${invoice.hosted_invoice_url}` : "",
      "",
      "No contract, month to month. Update your card or cancel any time in ROrunner under Settings → Payments & billing.",
      "Questions? Reply to this email or write to support@rorunner.com.",
    ].filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n");

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `receipt-${invoice.id}` },
      body: JSON.stringify({
        from: fromAddress(`${process.env.EMAIL_PRODUCT_NAME || "ROrunner"} Billing`, "billing"),
        to: [to],
        reply_to: "support@rorunner.com",
        subject: `Your ROrunner receipt — ${money}${invoice.number ? ` (#${invoice.number})` : ""}`,
        html,
        text,
      }),
    });
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
