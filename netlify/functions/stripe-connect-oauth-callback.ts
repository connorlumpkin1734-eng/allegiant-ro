// Completes Standard Stripe Connect: exchanges the one-time `code` Stripe redirected back with
// for the shop's connected account id, and saves it. Called by the client once the owner lands
// back on the app after authorizing (or creating) their Stripe account on connect.stripe.com.
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
  if (!supabaseUrl || !publicKey || !serviceKey || !stripeSecretKey) {
    return json({ error: "Payments configuration could not be loaded." }, 500);
  }

  const authorization = request.headers.get("authorization") || "";
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json({ error: "Sign in again before finishing Stripe setup." }, 401);
  const user = await userResponse.json() as { id: string };
  const body = await request.json().catch(() => ({})) as { code?: string };
  if (!body.code) return json({ error: "Missing Stripe authorization code." }, 400);

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const settingsResponse = await fetch(`${supabaseUrl}/rest/v1/settings?select=owner_id&owner_id=eq.${user.id}&limit=1`, { headers: serviceHeaders });
  const hasSettings = settingsResponse.ok && (await settingsResponse.json() as unknown[]).length > 0;
  if (!hasSettings) return json({ error: "Only the shop owner can connect Stripe." }, 403);

  const tokenResponse = await fetch("https://connect.stripe.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_secret: stripeSecretKey, code: body.code, grant_type: "authorization_code" }),
  });
  const token = await tokenResponse.json() as { stripe_user_id?: string; error_description?: string; error?: string };
  if (!tokenResponse.ok || !token.stripe_user_id) {
    return json({ error: token.error_description || token.error || "Stripe did not authorize the connection." }, 400);
  }

  const patchResponse = await fetch(`${supabaseUrl}/rest/v1/settings?owner_id=eq.${user.id}`, {
    method: "PATCH", headers: serviceHeaders,
    body: JSON.stringify({ stripe_account_id: token.stripe_user_id, stripe_account_type: "standard" }),
  });
  if (!patchResponse.ok) return json({ error: "Stripe connected but could not be saved. Try again or contact support." }, 500);

  // Pull current status immediately so the UI doesn't show "pending" for an account that's
  // actually already fully set up (common when linking an existing, already-verified account).
  const accountResponse = await fetch(`https://api.stripe.com/v1/accounts/${token.stripe_user_id}`, {
    headers: { Authorization: `Bearer ${stripeSecretKey}` },
  });
  const account = await accountResponse.json().catch(() => ({})) as { details_submitted?: boolean; charges_enabled?: boolean; payouts_enabled?: boolean };
  const flags = {
    stripe_onboarding_complete: Boolean(account.details_submitted),
    stripe_charges_enabled: Boolean(account.charges_enabled),
    stripe_payouts_enabled: Boolean(account.payouts_enabled),
  };
  if (accountResponse.ok) {
    await fetch(`${supabaseUrl}/rest/v1/settings?owner_id=eq.${user.id}`, { method: "PATCH", headers: serviceHeaders, body: JSON.stringify(flags) });
  }

  return json({ connected: true, accountType: "standard", ...flags });
};
