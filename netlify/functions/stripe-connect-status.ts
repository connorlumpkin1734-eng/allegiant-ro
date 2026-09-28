// Re-checks the shop's connected Stripe account and syncs onboarding/charges/payouts flags onto
// settings. Called when the owner lands back from Stripe onboarding and from a manual "Refresh
// status" button — the account.updated webhook (see stripe-webhook.ts) keeps this in sync the
// rest of the time, but a synchronous check here means the UI updates immediately on return.
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
  if (!userResponse.ok) return json({ error: "Sign in again." }, 401);
  const user = await userResponse.json() as { id: string };

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const settingsResponse = await fetch(`${supabaseUrl}/rest/v1/settings?select=owner_id,stripe_account_id&owner_id=eq.${user.id}&limit=1`, { headers: serviceHeaders });
  const settings = (settingsResponse.ok ? await settingsResponse.json() as Array<{ owner_id: string; stripe_account_id: string | null }> : [])[0];
  if (!settings) return json({ error: "Only the shop owner can check Stripe status." }, 403);
  if (!settings.stripe_account_id) return json({ connected: false });

  const accountResponse = await fetch(`https://api.stripe.com/v1/accounts/${settings.stripe_account_id}`, {
    headers: { Authorization: `Bearer ${stripeSecretKey}` },
  });
  const account = await accountResponse.json() as {
    details_submitted?: boolean; charges_enabled?: boolean; payouts_enabled?: boolean; error?: { message?: string };
  };
  if (!accountResponse.ok) return json({ error: account.error?.message || "Could not check Stripe status." }, 400);

  const flags = {
    stripe_onboarding_complete: Boolean(account.details_submitted),
    stripe_charges_enabled: Boolean(account.charges_enabled),
    stripe_payouts_enabled: Boolean(account.payouts_enabled),
  };
  await fetch(`${supabaseUrl}/rest/v1/settings?owner_id=eq.${user.id}`, { method: "PATCH", headers: serviceHeaders, body: JSON.stringify(flags) });

  return json({ connected: true, ...flags });
};
