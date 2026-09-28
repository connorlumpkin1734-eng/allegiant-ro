// Creates a Stripe Checkout Session on the SHOP's own connected account (not the platform's) for
// a repair order invoice, then records a `payments` row so the webhook can mark it paid.
//
// v1 scope, explicitly: the charged amount is the invoice's current subtotal + tax across ALL
// line items. It does not yet exclude jobs the customer declined during estimate approval
// (invoice_overrides / declined-job logic that the printed invoice view applies). For a repair
// order where nothing was declined this is exactly right; for one with declined work, the shop
// should double check the amount before sending the payment link. Flagging this rather than
// silently shipping it as if it were handled.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

type LineItem = { item_type: string; quantity: number; unit_price: number; taxable: boolean };
type RepairOrderRow = {
  id: string;
  owner_id: string;
  ro_number: number;
  tax_rate: number;
  customers: { name: string | null; email: string | null } | null;
  line_items: LineItem[];
};

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(request.url).origin;
  if (!supabaseUrl || !publicKey || !serviceKey || !stripeSecretKey) {
    return json({ error: "Payments configuration could not be loaded." }, 500);
  }

  const authorization = request.headers.get("authorization") || "";
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json({ error: "Sign in again before collecting payment." }, 401);
  const caller = await userResponse.json() as { id: string };
  const body = await request.json().catch(() => ({})) as { repairOrderId?: string };
  if (!body.repairOrderId) return json({ error: "Missing repair order." }, 400);

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  // Resolve the caller to a shop (owner_id): either the owner themselves, or staff (advisor/admin)
  // acting on behalf of their shop. Mirrors the staff-resolution the client does in page.tsx.
  let ownerId = caller.id;
  const settingsSelfResponse = await fetch(`${supabaseUrl}/rest/v1/settings?select=owner_id&owner_id=eq.${caller.id}&limit=1`, { headers: serviceHeaders });
  const isOwner = settingsSelfResponse.ok && (await settingsSelfResponse.json() as unknown[]).length > 0;
  if (!isOwner) {
    const staffResponse = await fetch(
      `${supabaseUrl}/rest/v1/staff?select=owner_id,role,is_admin&auth_user_id=eq.${caller.id}&active=eq.true&limit=1`,
      { headers: serviceHeaders }
    );
    const staffRows = staffResponse.ok ? await staffResponse.json() as Array<{ owner_id: string; role: string; is_admin: boolean }> : [];
    const staff = staffRows[0];
    if (!staff || (staff.role !== "service_advisor" && !staff.is_admin)) {
      return json({ error: "Only the shop owner or a service advisor can collect payment." }, 403);
    }
    ownerId = staff.owner_id;
  }

  const settingsResponse = await fetch(`${supabaseUrl}/rest/v1/settings?select=stripe_account_id,stripe_charges_enabled,business_name&owner_id=eq.${ownerId}&limit=1`, { headers: serviceHeaders });
  const settings = (settingsResponse.ok ? await settingsResponse.json() as Array<{ stripe_account_id: string | null; stripe_charges_enabled: boolean; business_name: string | null }> : [])[0];
  if (!settings?.stripe_account_id) return json({ error: "Connect Stripe in Settings before collecting payment." }, 400);
  if (!settings.stripe_charges_enabled) return json({ error: "Stripe onboarding isn't finished yet — finish it in Settings before collecting payment." }, 400);

  const roResponse = await fetch(
    `${supabaseUrl}/rest/v1/repair_orders?select=id,owner_id,ro_number,tax_rate,customers(name,email),line_items(item_type,quantity,unit_price,taxable)&id=eq.${encodeURIComponent(body.repairOrderId)}&owner_id=eq.${ownerId}`,
    { headers: serviceHeaders }
  );
  const roRows = roResponse.ok ? await roResponse.json() as RepairOrderRow[] : [];
  const ro = roRows[0];
  if (!ro) return json({ error: "Repair order not found." }, 404);

  const items = ro.line_items || [];
  const subtotal = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price), 0);
  const taxableAmount = items.reduce((sum, item) => sum + (item.taxable ? Number(item.quantity) * Number(item.unit_price) : 0), 0);
  const tax = Math.max(0, taxableAmount) * (Number(ro.tax_rate) / 100);
  const total = subtotal + tax;
  if (total <= 0) return json({ error: "This invoice has nothing to charge." }, 400);
  const amountCents = Math.round(total * 100);

  const roNumberLabel = `#${String(ro.ro_number).padStart(4, "0")}`;
  const successUrl = new URL(`/?paid=1&ro=${ro.id}`, siteUrl).toString();
  const cancelUrl = new URL(`/?paid=0&ro=${ro.id}`, siteUrl).toString();

  const sessionParams = new URLSearchParams({
    mode: "payment",
    "payment_method_types[0]": "card",
    "payment_method_types[1]": "us_bank_account",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(amountCents),
    "line_items[0][price_data][product_data][name]": `Invoice ${roNumberLabel}${settings.business_name ? ` — ${settings.business_name}` : ""}`,
    success_url: successUrl,
    cancel_url: cancelUrl,
    "metadata[repair_order_id]": ro.id,
    "metadata[owner_id]": ownerId,
  });
  if (ro.customers?.email) sessionParams.set("customer_email", ro.customers.email);

  const sessionResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Account": settings.stripe_account_id,
    },
    body: sessionParams,
  });
  const session = await sessionResponse.json() as { id?: string; url?: string; error?: { message?: string } };
  if (!sessionResponse.ok || !session.id || !session.url) {
    return json({ error: session.error?.message || "Could not start a Stripe checkout session." }, 400);
  }

  const paymentInsert = await fetch(`${supabaseUrl}/rest/v1/payments`, {
    method: "POST",
    headers: { ...serviceHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      owner_id: ownerId,
      repair_order_id: ro.id,
      processor: "stripe",
      processor_account_id: settings.stripe_account_id,
      processor_session_id: session.id,
      amount: total,
      currency: "usd",
      status: "pending",
    }),
  });
  if (!paymentInsert.ok) return json({ error: `Checkout session created but could not be recorded: ${await paymentInsert.text()}` }, 500);

  return json({ url: session.url, amount: total });
};
