// Starts Stripe onboarding for the calling shop owner. Two paths, chosen by the client:
//  - "express": creates (if needed) a Stripe Express connected account and returns a fresh
//    Account Link URL. Quick, Stripe-hosted, no existing-account option — always a brand new
//    account under the platform.
//  - "standard": returns a Stripe Connect OAuth authorize URL instead. This is the path that
//    lets a shop that already has a Stripe account log into it and link it directly, or create a
//    new full Stripe account they'll manage themselves. The actual linking happens in
//    stripe-connect-oauth-callback.ts once Stripe redirects back with a code.
// Called both for the first "Connect with Stripe" click and for "Continue onboarding" on an
// express account (account links expire after a few minutes, so the client should call this
// fresh each time rather than caching one).
//
// Express account creation uses the Accounts v2 API (/v2/core/accounts + /v2/core/account_links)
// rather than v1 (/v1/accounts + /v1/account_links). This Stripe account has v1 account *creation*
// disabled by default (Stripe's current default for new Connect platforms) — only v2 creation
// works. Everything else (OAuth for Standard, reading account status, the account.updated
// webhook) still works fine against v1-shaped data even for v2-created accounts, per Stripe's
// docs, so only creation + the onboarding link needed to move to v2 endpoints.
const STRIPE_API_VERSION = "2026-08-26.dahlia";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const stripeConnectClientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(request.url).origin;
  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", supabaseUrl],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publicKey],
    ["SUPABASE_SERVICE_ROLE_KEY", serviceKey],
    ["STRIPE_SECRET_KEY", stripeSecretKey],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    return json({ error: `Payments are not configured on this deployment (missing ${missing.join(", ")}).` }, 500);
  }
  if (!supabaseUrl || !publicKey || !serviceKey || !stripeSecretKey) {
    return json({ error: "Payments configuration could not be loaded." }, 500);
  }

  const authorization = request.headers.get("authorization") || "";
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json({ error: "Sign in again before connecting Stripe." }, 401);
  const user = await userResponse.json() as { id: string };
  const requestBody = await request.json().catch(() => ({})) as { accountType?: string };
  const accountType = requestBody.accountType === "standard" ? "standard" : "express";

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  // Owner-only: only the shop owner can connect/reconnect the shop's Stripe account.
  const settingsResponse = await fetch(
    `${supabaseUrl}/rest/v1/settings?select=owner_id,stripe_account_id,business_name,business_email&owner_id=eq.${user.id}&limit=1`,
    { headers: serviceHeaders }
  );
  const settingsRows = settingsResponse.ok ? await settingsResponse.json() as Array<{ owner_id: string; stripe_account_id: string | null; business_name: string | null; business_email: string | null }> : [];
  const settings = settingsRows[0];
  if (!settings) return json({ error: "Only the shop owner can connect Stripe." }, 403);

  if (accountType === "standard") {
    if (!stripeConnectClientId) return json({ error: "Standard Stripe connections aren't configured on this deployment (missing STRIPE_CONNECT_CLIENT_ID)." }, 500);
    const redirectUri = new URL("/?stripe_oauth=1", siteUrl).toString();
    const authorizeUrl = new URL("https://connect.stripe.com/oauth/authorize");
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", stripeConnectClientId);
    authorizeUrl.searchParams.set("scope", "read_write");
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    return json({ url: authorizeUrl.toString() });
  }

  const stripeV2Headers = {
    Authorization: `Bearer ${stripeSecretKey}`,
    "Content-Type": "application/json",
    "Stripe-Version": STRIPE_API_VERSION,
  };
  let accountId = settings.stripe_account_id;

  if (!accountId) {
    const createBody = {
      contact_email: settings.business_email || undefined,
      display_name: settings.business_name || undefined,
      identity: { country: "us", entity_type: "company" },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      // Express-dashboard accounts require the platform (us) to own fees and losses.
      defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" } },
      dashboard: "express",
    };
    const createResponse = await fetch("https://api.stripe.com/v2/core/accounts", {
      method: "POST", headers: stripeV2Headers, body: JSON.stringify(createBody),
    });
    const created = await createResponse.json() as { id?: string; error?: { message?: string } };
    if (!createResponse.ok || !created.id) {
      return json({ error: created.error?.message || "Could not create the Stripe account." }, 400);
    }
    accountId = created.id;

    const patchResponse = await fetch(`${supabaseUrl}/rest/v1/settings?owner_id=eq.${user.id}`, {
      method: "PATCH", headers: serviceHeaders, body: JSON.stringify({ stripe_account_id: accountId, stripe_account_type: "express" }),
    });
    if (!patchResponse.ok) return json({ error: "Stripe account was created but could not be saved. Try again." }, 500);
  }

  const returnUrl = new URL("/?stripe=return", siteUrl).toString();
  const refreshUrl = new URL("/?stripe=refresh", siteUrl).toString();
  const linkBody = {
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: { configurations: ["merchant"], return_url: returnUrl, refresh_url: refreshUrl },
    },
  };
  const linkResponse = await fetch("https://api.stripe.com/v2/core/account_links", {
    method: "POST", headers: stripeV2Headers, body: JSON.stringify(linkBody),
  });
  const link = await linkResponse.json() as { url?: string; error?: { message?: string } };
  if (!linkResponse.ok || !link.url) {
    return json({ error: link.error?.message || "Could not start Stripe onboarding." }, 400);
  }

  return json({ url: link.url });
};
