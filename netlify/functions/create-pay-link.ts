// Staff-only. Creates the single "pay this invoice" link a shop shares with a customer; the customer
// then chooses card/bank or Zelle on the public /pay page (see pay-invoice.ts). Only the hash of the
// token is stored. Same owner/advisor/admin permission rule as create-payment-session.ts.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

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
    // Nothing more to do if the alert itself fails.
  }
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(request.url).origin;
  if (!supabaseUrl || !publicKey || !serviceKey) return json({ error: "Payments configuration could not be loaded." }, 500);

  const authorization = request.headers.get("authorization") || "";
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: publicKey, Authorization: authorization } });
  if (!userResponse.ok) return json({ error: "Sign in again before collecting payment." }, 401);
  const caller = await userResponse.json() as { id: string };
  const body = await request.json().catch(() => ({})) as { repairOrderId?: string };
  if (!body.repairOrderId) return json({ error: "Missing repair order." }, 400);

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  let ownerId = caller.id;
  const selfResponse = await fetch(`${supabaseUrl}/rest/v1/settings?select=owner_id&owner_id=eq.${caller.id}&limit=1`, { headers: serviceHeaders });
  const isOwner = selfResponse.ok && (await selfResponse.json() as unknown[]).length > 0;
  if (!isOwner) {
    const staffResponse = await fetch(`${supabaseUrl}/rest/v1/staff?select=owner_id,role,is_admin&auth_user_id=eq.${caller.id}&active=eq.true&limit=1`, { headers: serviceHeaders });
    const staff = (staffResponse.ok ? await staffResponse.json() as Array<{ owner_id: string; role: string; is_admin: boolean }> : [])[0];
    if (!staff || (staff.role !== "service_advisor" && !staff.is_admin)) {
      return json({ error: "Only the shop owner or a service advisor can collect payment." }, 403);
    }
    ownerId = staff.owner_id;
  }

  const settingsResponse = await fetch(`${supabaseUrl}/rest/v1/settings?select=stripe_account_id,stripe_charges_enabled,zelle_recipient,subscription_status&owner_id=eq.${ownerId}&limit=1`, { headers: serviceHeaders });
  const settings = (settingsResponse.ok ? await settingsResponse.json() as Array<{ stripe_account_id: string | null; stripe_charges_enabled: boolean; zelle_recipient: string | null; subscription_status: string }> : [])[0];
  if (!settings) return json({ error: "Shop settings not found." }, 404);
  if (settings.subscription_status === "trialing") {
    return json({ error: "Payment processing isn't available during the free trial. Subscribe to accept customer payments." }, 403);
  }
  const card = Boolean(settings.stripe_account_id && settings.stripe_charges_enabled);
  const zelle = Boolean(settings.zelle_recipient);
  if (!card && !zelle) return json({ error: "Connect Stripe or add a Zelle phone number or email in Settings before collecting payment." }, 400);

  const roResponse = await fetch(`${supabaseUrl}/rest/v1/repair_orders?select=id,paid,status&id=eq.${encodeURIComponent(body.repairOrderId)}&owner_id=eq.${ownerId}&limit=1`, { headers: serviceHeaders });
  const ro = (roResponse.ok ? await roResponse.json() as Array<{ id: string; paid: boolean; status: string }> : [])[0];
  if (!ro) return json({ error: "Repair order not found." }, 404);
  if (ro.paid) return json({ error: "This invoice is already paid." }, 400);
  if (ro.status === "voided") return json({ error: "This repair order was voided." }, 400);

  const token = generateToken();
  const insert = await fetch(`${supabaseUrl}/rest/v1/payment_links`, {
    method: "POST",
    headers: { ...serviceHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ owner_id: ownerId, repair_order_id: ro.id, token_hash: await hashToken(token) }),
  });
  if (!insert.ok) return json({ error: `Could not create the payment link: ${await insert.text()}` }, 500);

  return json({ url: new URL(`/pay?token=${token}`, siteUrl).toString(), methods: { card, zelle } });
}

export default async (request: Request) => {
  try {
    return await handler(request);
  } catch (error) {
    await notifyError("create-pay-link", error, request);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};
