// Creates a Stripe Checkout Session on the SHOP's own connected account (not the platform's) for
// a repair order invoice, then records a `payments` row so the webhook can mark it paid.
//
// The charged amount mirrors exactly what the printed/previewed invoice shows: jobs the customer
// declined during estimate approval are excluded unless the shop separately recorded authorization
// for them (invoice_overrides), same as the authorizedLineItems()/repairOrderTotal() logic in
// app/page.tsx. Keep this in sync with that logic if it ever changes.
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


type LineItem = { item_type: string; quantity: number; unit_price: number; taxable: boolean; service_group_id: string | null };
type InvoiceOverrides = Record<string, { note: string; recorded_at: string; recorded_by: string }>;
type EstimateAuthorization = {
  status: string;
  line_decisions: Record<string, "approved" | "declined"> | null;
};
type RepairOrderRow = {
  id: string;
  owner_id: string;
  ro_number: number;
  tax_rate: number;
  invoice_overrides: InvoiceOverrides | null;
  customers: { name: string | null; email: string | null } | null;
  line_items: LineItem[];
};

// Mirrors hasAuthorizationResponse() in app/page.tsx.
function hasAuthorizationResponse(authorization: EstimateAuthorization | null | undefined): authorization is EstimateAuthorization {
  return Boolean(
    authorization
      && ["approved", "partially_approved", "declined"].includes(authorization.status)
      && Object.keys(authorization.line_decisions ?? {}).length > 0
  );
}

// Mirrors authorizedLineItems() in app/page.tsx.
function authorizedLineItems(
  items: LineItem[],
  authorization: EstimateAuthorization | null | undefined,
  overrides: InvoiceOverrides = {}
): LineItem[] {
  if (!hasAuthorizationResponse(authorization)) return items;
  const decisions = authorization.line_decisions ?? {};
  const hasApprovedService = Object.values(decisions).includes("approved") || items.some((item) => item.service_group_id && overrides[item.service_group_id]);
  return items.filter((item) =>
    item.service_group_id
      ? decisions[item.service_group_id] === "approved" || Boolean(overrides[item.service_group_id])
      : hasApprovedService
  );
}

async function handler(request: Request): Promise<Response> {
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

  const settingsResponse = await fetch(`${supabaseUrl}/rest/v1/settings?select=stripe_account_id,stripe_charges_enabled,business_name,subscription_status&owner_id=eq.${ownerId}&limit=1`, { headers: serviceHeaders });
  const settings = (settingsResponse.ok ? await settingsResponse.json() as Array<{ stripe_account_id: string | null; stripe_charges_enabled: boolean; business_name: string | null; subscription_status: string }> : [])[0];
  if (!settings) return json({ error: "Shop settings not found." }, 404);
  // No customer payment processing during the free trial, full stop — even if a trial shop somehow
  // finished Stripe Connect onboarding before subscribing. Matches the same rule for Zelle in
  // request-zelle-payment.ts.
  if (settings.subscription_status === "trialing") {
    return json({ error: "Payment processing isn't available during the free trial. Subscribe to accept customer payments." }, 403);
  }
  if (!settings.stripe_account_id) return json({ error: "Connect Stripe in Settings before collecting payment." }, 400);
  if (!settings.stripe_charges_enabled) return json({ error: "Stripe onboarding isn't finished yet — finish it in Settings before collecting payment." }, 400);

  const roResponse = await fetch(
    `${supabaseUrl}/rest/v1/repair_orders?select=id,owner_id,ro_number,tax_rate,invoice_overrides,customers(name,email),line_items(item_type,quantity,unit_price,taxable,service_group_id)&id=eq.${encodeURIComponent(body.repairOrderId)}&owner_id=eq.${ownerId}`,
    { headers: serviceHeaders }
  );
  const roRows = roResponse.ok ? await roResponse.json() as RepairOrderRow[] : [];
  const ro = roRows[0];
  if (!ro) return json({ error: "Repair order not found." }, 404);

  const authorizationResponse = await fetch(
    `${supabaseUrl}/rest/v1/estimate_authorizations?select=status,line_decisions&repair_order_id=eq.${encodeURIComponent(ro.id)}&order=sent_at.desc&limit=1`,
    { headers: serviceHeaders }
  );
  const authorizationRows = authorizationResponse.ok ? await authorizationResponse.json() as EstimateAuthorization[] : [];
  const estimateAuthorization = authorizationRows[0] ?? null;

  const items = authorizedLineItems(ro.line_items || [], estimateAuthorization, ro.invoice_overrides ?? {});
  const subtotal = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price), 0);
  const taxableAmount = items.reduce((sum, item) => sum + (item.taxable ? Number(item.quantity) * Number(item.unit_price) : 0), 0);
  const tax = Math.max(0, taxableAmount) * (Number(ro.tax_rate) / 100);
  const total = subtotal + tax;
  if (total <= 0) return json({ error: "This invoice has nothing to charge." }, 400);
  const amountCents = Math.round(total * 100);

  const roNumberDigits = String(ro.ro_number).padStart(4, "0");
  const roNumberLabel = `#${roNumberDigits}`;
  const statusParams = `ro_number=${roNumberDigits}${settings.business_name ? `&business=${encodeURIComponent(settings.business_name)}` : ""}`;
  const successUrl = new URL(`/payment-status?status=success&${statusParams}`, siteUrl).toString();
  const cancelUrl = new URL(`/payment-status?status=canceled&${statusParams}`, siteUrl).toString();

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
  if (!paymentInsert.ok) {
    const insertError = await paymentInsert.text();
    // The Stripe session exists but we couldn't record it, so the webhook would never be able to
    // match a completed payment back to this repair order. Expire the session so it can never
    // actually be paid, rather than leaving a live, untracked payment link floating around —
    // mirrors the rollback pattern used elsewhere (e.g. invite-staff.ts undoing the auth user it
    // created when the follow-up staff-row insert fails).
    try {
      await fetch(`https://api.stripe.com/v1/checkout/sessions/${session.id}/expire`, {
        method: "POST",
        headers: { Authorization: `Bearer ${stripeSecretKey}`, "Stripe-Account": settings.stripe_account_id },
      });
    } catch {
      // Best-effort — if this also fails, the session still self-expires on Stripe's side within 24h.
    }
    return json({ error: `Could not start checkout — please try again: ${insertError}` }, 500);
  }

  return json({ url: session.url, amount: total });
}

export default async (request: Request) => {
  try {
    return await handler(request);
  } catch (error) {
    await notifyError("create-payment-session", error, request);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};
