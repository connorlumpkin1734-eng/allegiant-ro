import { notifyError } from "../../lib/platform-alert";
import { ensureSubscriptionProduct } from "../../lib/subscription-product";
// Starts a Stripe Checkout session for a shop to SUBSCRIBE to the platform itself (this is us
// billing the shop, unlike create-payment-session.ts which is a shop billing its own customer via
// their own connected Stripe account). Created directly on the platform's own Stripe account — no
// Stripe-Account header — so its webhook events land as plain platform events in stripe-webhook.ts.
//
// The price is never hardcoded: it's whatever settings.plan_price_cents already says for this shop
// (locked in at signup from platform_config.default_plan_price_cents, or adjusted per-shop later by
// Connor via the platform-admin function). Passed to Stripe as inline recurring price_data rather
// than a pre-created Price object, since each shop can have its own price.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

// Best-effort alert email to Connor when this function throws an uncaught exception — otherwise a
// bug or an upstream outage (Stripe/Supabase/Resend down) fails silently with nobody finding out
// until a shop or customer complains. Never lets the alert itself break the real response.

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(request.url).origin;
  if (!supabaseUrl || !publicKey || !serviceKey || !stripeSecretKey) {
    return json({ error: "Billing configuration could not be loaded." }, 500);
  }

  const authorization = request.headers.get("authorization") || "";
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json({ error: "Sign in again before subscribing." }, 401);
  const user = await userResponse.json() as { id: string };

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  // Owner-only: billing is a shop-owner decision, not something staff (even admins) can do.
  const settingsResponse = await fetch(
    `${supabaseUrl}/rest/v1/settings?select=owner_id,business_name,business_email,plan_price_cents,subscription_status,stripe_customer_id&owner_id=eq.${user.id}&limit=1`,
    { headers: serviceHeaders }
  );
  const settingsRows = settingsResponse.ok
    ? await settingsResponse.json() as Array<{ owner_id: string; business_name: string | null; business_email: string | null; plan_price_cents: number | null; subscription_status: string; stripe_customer_id: string | null }>
    : [];
  const settings = settingsRows[0];
  if (!settings) return json({ error: "Only the shop owner can manage billing." }, 403);
  if (settings.subscription_status === "active") return json({ error: "This shop already has an active subscription." }, 400);
  if (settings.subscription_status === "exempt") return json({ error: "This shop isn't billed — nothing to subscribe to." }, 400);
  if (!settings.plan_price_cents || settings.plan_price_cents <= 0) {
    return json({ error: "This shop doesn't have a price set yet. Contact support." }, 400);
  }

  const stripeHeaders = { Authorization: `Bearer ${stripeSecretKey}`, "Content-Type": "application/x-www-form-urlencoded" };

  let customerId = settings.stripe_customer_id;
  if (!customerId) {
    const customerParams = new URLSearchParams({ "metadata[owner_id]": user.id });
    if (settings.business_email) customerParams.set("email", settings.business_email);
    if (settings.business_name) customerParams.set("name", settings.business_name);
    const customerResponse = await fetch("https://api.stripe.com/v1/customers", {
      method: "POST", headers: stripeHeaders, body: customerParams,
    });
    const customer = await customerResponse.json() as { id?: string; error?: { message?: string } };
    if (!customerResponse.ok || !customer.id) {
      return json({ error: customer.error?.message || "Could not create a billing profile." }, 400);
    }
    customerId = customer.id;
    await fetch(`${supabaseUrl}/rest/v1/settings?owner_id=eq.${user.id}`, {
      method: "PATCH", headers: serviceHeaders, body: JSON.stringify({ stripe_customer_id: customerId }),
    });
  }

  // { embedded: true } keeps checkout inside ROrunner's Settings page (Stripe's embedded checkout);
  // otherwise it's Stripe's hosted page.
  const requestBody = await request.json().catch(() => ({})) as { embedded?: boolean; theme?: string };
  const embedded = requestBody.embedded === true;

  const returnUrl = new URL("/", siteUrl);
  const sessionParams = new URLSearchParams({
    mode: "subscription",
    customer: customerId,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(settings.plan_price_cents),
    "line_items[0][price_data][recurring][interval]": "month",
    "line_items[0][price_data][product]": await ensureSubscriptionProduct(stripeSecretKey),
    "metadata[owner_id]": user.id,
    "subscription_data[metadata][owner_id]": user.id,
  });
  if (embedded) {
    // Stripe renamed "embedded" to "embedded_page" in API 2026-03-25.dahlia; try the current name
    // first and the older one if this account is on an earlier API version.
    sessionParams.set("ui_mode", "embedded_page");
    // Match the person's light or dark ROrunner theme so the form blends into the Settings page.
    const dark = requestBody.theme === "dark";
    sessionParams.set("branding_settings[background_color]", dark ? "#161922" : "#ffffff");
    sessionParams.set("branding_settings[button_color]", dark ? "#22d3ee" : "#102a4c");
    sessionParams.set("branding_settings[border_style]", "rounded");
    sessionParams.set("branding_settings[font_family]", "inter");
    sessionParams.set("branding_settings[display_name]", "ROrunner");
    sessionParams.set("return_url", new URL("?billing=success", returnUrl).toString());
  } else {
    sessionParams.set("success_url", new URL("?billing=success", returnUrl).toString());
    sessionParams.set("cancel_url", new URL("?billing=canceled", returnUrl).toString());
  }

  let sessionResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST", headers: stripeHeaders, body: sessionParams,
  });
  let session = await sessionResponse.json() as { url?: string; client_secret?: string; error?: { message?: string; param?: string } };
  if (embedded && !sessionResponse.ok && session.error?.param?.startsWith("branding_settings")) {
    for (const key of [...sessionParams.keys()]) if (key.startsWith("branding_settings")) sessionParams.delete(key);
    sessionResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST", headers: stripeHeaders, body: sessionParams,
    });
    session = await sessionResponse.json() as typeof session;
  }
  if (embedded && !sessionResponse.ok && session.error?.param === "ui_mode") {
    sessionParams.set("ui_mode", "embedded");
    sessionResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST", headers: stripeHeaders, body: sessionParams,
    });
    session = await sessionResponse.json() as typeof session;
  }
  if (!sessionResponse.ok) console.error("[create-subscription-checkout] Stripe refused the session:", session.error?.message);
  if (embedded) {
    if (!sessionResponse.ok || !session.client_secret) {
      return json({ error: session.error?.message || "Could not start checkout." }, 400);
    }
    return json({ clientSecret: session.client_secret });
  }
  if (!sessionResponse.ok || !session.url) {
    return json({ error: session.error?.message || "Could not start checkout." }, 400);
  }

  return json({ url: session.url });
}

export default async (request: Request) => {
  try {
    return await handler(request);
  } catch (error) {
    await notifyError("create-subscription-checkout", error, request);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};
