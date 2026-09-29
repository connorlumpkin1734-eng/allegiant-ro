// Cross-tenant admin actions for Connor only (the platform operator), not exposed via RLS to keep
// this out of the regular per-tenant policies entirely. Every call authenticates the caller, then
// checks THEIR OWN settings.is_platform_admin flag (set once, by migration, on Connor's shop) before
// doing anything cross-tenant. No other shop can ever see or touch another shop's billing this way.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

type Action =
  | { action: "list" }
  | { action: "update_price"; ownerId: string; planPriceCents: number }
  | { action: "update_status"; ownerId: string; status: "trialing" | "active" | "past_due" | "canceled" | "exempt" }
  | { action: "update_default_price"; defaultPlanPriceCents: number };

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !publicKey || !serviceKey) return json({ error: "Platform admin is not configured." }, 500);

  const authorization = request.headers.get("authorization") || "";
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json({ error: "Sign in again." }, 401);
  const user = await userResponse.json() as { id: string };

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  const callerResponse = await fetch(`${supabaseUrl}/rest/v1/settings?select=is_platform_admin&owner_id=eq.${user.id}&limit=1`, { headers: serviceHeaders });
  const callerRows = callerResponse.ok ? await callerResponse.json() as Array<{ is_platform_admin: boolean }> : [];
  if (!callerRows[0]?.is_platform_admin) return json({ error: "Not authorized." }, 403);

  const body = await request.json().catch(() => ({})) as Action;

  if (body.action === "list") {
    const [tenantsResponse, configResponse] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/settings?select=owner_id,business_name,business_email,subscription_status,plan_price_cents,trial_ro_limit,trial_ro_created_count,is_platform_admin,subscription_current_period_end&order=business_name.asc`,
        { headers: serviceHeaders }
      ),
      fetch(`${supabaseUrl}/rest/v1/platform_config?select=default_plan_price_cents&limit=1`, { headers: serviceHeaders }),
    ]);
    if (!tenantsResponse.ok) return json({ error: `Could not load shops: ${await tenantsResponse.text()}` }, 500);
    const tenants = await tenantsResponse.json();
    const config = configResponse.ok ? (await configResponse.json() as Array<{ default_plan_price_cents: number }>)[0] : null;
    return json({ tenants, defaultPlanPriceCents: config?.default_plan_price_cents ?? null });
  }

  if (body.action === "update_price") {
    if (!body.ownerId || !Number.isFinite(body.planPriceCents) || body.planPriceCents < 0) {
      return json({ error: "Missing or invalid shop/price." }, 400);
    }
    const response = await fetch(`${supabaseUrl}/rest/v1/settings?owner_id=eq.${body.ownerId}`, {
      method: "PATCH", headers: serviceHeaders, body: JSON.stringify({ plan_price_cents: Math.round(body.planPriceCents) }),
    });
    if (!response.ok) return json({ error: `Could not update price: ${await response.text()}` }, 500);
    return json({ message: "Price updated." });
  }

  if (body.action === "update_status") {
    const validStatuses = ["trialing", "active", "past_due", "canceled", "exempt"];
    if (!body.ownerId || !validStatuses.includes(body.status)) return json({ error: "Missing or invalid shop/status." }, 400);
    const response = await fetch(`${supabaseUrl}/rest/v1/settings?owner_id=eq.${body.ownerId}`, {
      method: "PATCH", headers: serviceHeaders, body: JSON.stringify({ subscription_status: body.status }),
    });
    if (!response.ok) return json({ error: `Could not update status: ${await response.text()}` }, 500);
    return json({ message: "Status updated." });
  }

  if (body.action === "update_default_price") {
    if (!Number.isFinite(body.defaultPlanPriceCents) || body.defaultPlanPriceCents < 0) return json({ error: "Invalid price." }, 400);
    const response = await fetch(`${supabaseUrl}/rest/v1/platform_config?id=eq.true`, {
      method: "PATCH", headers: serviceHeaders, body: JSON.stringify({ default_plan_price_cents: Math.round(body.defaultPlanPriceCents) }),
    });
    if (!response.ok) return json({ error: `Could not update default price: ${await response.text()}` }, 500);
    return json({ message: "Default price for new shops updated." });
  }

  return json({ error: "Unknown action." }, 400);
};
