// Returns a Stripe Billing Portal link so a shop owner can update their card, see past invoices,
// or cancel — without us ever building custom card-management UI or touching card data ourselves.
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
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(request.url).origin;
  if (!supabaseUrl || !publicKey || !serviceKey || !stripeSecretKey) {
    return json({ error: "Billing configuration could not be loaded." }, 500);
  }

  const authorization = request.headers.get("authorization") || "";
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json({ error: "Sign in again before managing billing." }, 401);
  const user = await userResponse.json() as { id: string };

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const settingsResponse = await fetch(`${supabaseUrl}/rest/v1/settings?select=owner_id,stripe_customer_id&owner_id=eq.${user.id}&limit=1`, { headers: serviceHeaders });
  const settingsRows = settingsResponse.ok ? await settingsResponse.json() as Array<{ owner_id: string; stripe_customer_id: string | null }> : [];
  const settings = settingsRows[0];
  if (!settings) return json({ error: "Only the shop owner can manage billing." }, 403);
  if (!settings.stripe_customer_id) return json({ error: "Subscribe first before managing billing." }, 400);

  const portalParams = new URLSearchParams({
    customer: settings.stripe_customer_id,
    return_url: new URL("/", siteUrl).toString(),
  });
  const portalResponse = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${stripeSecretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: portalParams,
  });
  const portal = await portalResponse.json() as { url?: string; error?: { message?: string } };
  if (!portalResponse.ok || !portal.url) {
    return json({ error: portal.error?.message || "Could not open the billing portal." }, 400);
  }

  return json({ url: portal.url });
};
