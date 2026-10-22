// Public, token-gated. The customer opens ONE link and chooses how to pay:
//   GET  ?token=…                      -> invoice summary + which payment methods this shop offers
//   POST { token, method: "card" }     -> creates a fresh Stripe Checkout session, returns its URL
//   POST { token, method: "zelle" }    -> creates a pending Zelle payment, returns the pay-zelle URL
// The amount is recomputed from the live invoice on every call (same rules as create-payment-session.ts
// and request-zelle-payment.ts — keep them in sync). Nothing here marks an invoice paid: Stripe's
// webhook does that for card/bank, and staff confirm Zelle by hand.
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

type LineItem = { item_type: string; quantity: number; unit_price: number; taxable: boolean; service_group_id: string | null };
type InvoiceOverrides = Record<string, { note: string; recorded_at: string; recorded_by: string }>;
type EstimateAuthorization = { status: string; line_decisions: Record<string, "approved" | "declined"> | null };
type RepairOrderRow = {
  id: string; owner_id: string; ro_number: number; tax_rate: number; paid: boolean; status: string;
  invoice_overrides: InvoiceOverrides | null; customers: { email: string | null } | null; line_items: LineItem[];
};

function hasAuthorizationResponse(a: EstimateAuthorization | null | undefined): a is EstimateAuthorization {
  return Boolean(a && ["approved", "partially_approved", "declined"].includes(a.status) && Object.keys(a.line_decisions ?? {}).length > 0);
}
function authorizedLineItems(items: LineItem[], a: EstimateAuthorization | null | undefined, overrides: InvoiceOverrides = {}): LineItem[] {
  if (!hasAuthorizationResponse(a)) return items;
  const decisions = a.line_decisions ?? {};
  const hasApprovedService = Object.values(decisions).includes("approved") || items.some((item) => item.service_group_id && overrides[item.service_group_id]);
  return items.filter((item) =>
    item.service_group_id
      ? decisions[item.service_group_id] === "approved" || Boolean(overrides[item.service_group_id])
      : hasApprovedService
  );
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function clientIp(request: Request): string {
  return request.headers.get("x-nf-client-connection-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
// Public endpoint: rate limit by IP. Fails open so an outage of the limiter never blocks a real payment.
async function checkRateLimit(supabaseUrl: string, serviceKey: string, key: string, windowSeconds: number, maxRequests: number): Promise<boolean> {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/check_rate_limit`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_key: key, p_window_seconds: windowSeconds, p_max_requests: maxRequests }),
    });
    if (!response.ok) return true;
    return await response.json() as boolean;
  } catch {
    return true;
  }
}

async function handler(request: Request): Promise<Response> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(request.url).origin;
  if (!supabaseUrl || !serviceKey) return json({ error: "Payments configuration could not be loaded." }, 500);
  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  if (request.method !== "GET" && request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const allowed = await checkRateLimit(supabaseUrl, serviceKey, `pay-invoice:${request.method}:${clientIp(request)}`, 600, request.method === "POST" ? 20 : 60);
  if (!allowed) return json({ error: "Too many requests — please wait a few minutes and try again." }, 429);

  let token: string | null;
  let method: string | undefined;
  if (request.method === "GET") {
    token = new URL(request.url).searchParams.get("token");
  } else {
    const body = await request.json().catch(() => ({})) as { token?: string; method?: string };
    token = body.token ?? null;
    method = body.method;
  }
  if (!token || token.length < 32) return json({ error: "This payment link is invalid." }, 400);
  const tokenHash = await hashToken(token);

  const linkResponse = await fetch(`${supabaseUrl}/rest/v1/payment_links?select=owner_id,repair_order_id,expires_at&token_hash=eq.${tokenHash}&limit=1`, { headers: serviceHeaders });
  const link = linkResponse.ok ? (await linkResponse.json() as Array<{ owner_id: string; repair_order_id: string; expires_at: string }>)[0] : undefined;
  if (!link) return json({ error: "This payment link is invalid or has expired." }, 404);
  if (new Date(link.expires_at).getTime() < Date.now()) return json({ error: "This payment link has expired. Please contact the shop for a new one." }, 410);

  const [settingsResponse, roResponse, authorizationResponse] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/settings?select=business_name,zelle_recipient,stripe_account_id,stripe_charges_enabled,subscription_status&owner_id=eq.${link.owner_id}&limit=1`, { headers: serviceHeaders }),
    fetch(`${supabaseUrl}/rest/v1/repair_orders?select=id,owner_id,ro_number,tax_rate,paid,status,invoice_overrides,customers(email),line_items(item_type,quantity,unit_price,taxable,service_group_id)&id=eq.${encodeURIComponent(link.repair_order_id)}&owner_id=eq.${link.owner_id}&limit=1`, { headers: serviceHeaders }),
    fetch(`${supabaseUrl}/rest/v1/estimate_authorizations?select=status,line_decisions&repair_order_id=eq.${encodeURIComponent(link.repair_order_id)}&order=sent_at.desc&limit=1`, { headers: serviceHeaders }),
  ]);
  const settings = (settingsResponse.ok ? await settingsResponse.json() as Array<{ business_name: string | null; zelle_recipient: string | null; stripe_account_id: string | null; stripe_charges_enabled: boolean; subscription_status: string }> : [])[0];
  const ro = (roResponse.ok ? await roResponse.json() as RepairOrderRow[] : [])[0];
  const authorization = (authorizationResponse.ok ? await authorizationResponse.json() as EstimateAuthorization[] : [])[0] ?? null;
  if (!settings || !ro || ro.status === "voided") return json({ error: "This payment link is invalid or has expired." }, 404);

  const items = authorizedLineItems(ro.line_items || [], authorization, ro.invoice_overrides ?? {});
  const subtotal = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price), 0);
  const taxable = items.reduce((sum, item) => sum + (item.taxable ? Number(item.quantity) * Number(item.unit_price) : 0), 0);
  const total = subtotal + Math.max(0, taxable) * (Number(ro.tax_rate) / 100);

  const trialBlocked = settings.subscription_status === "trialing";
  const cardAvailable = !trialBlocked && Boolean(stripeSecretKey && settings.stripe_account_id && settings.stripe_charges_enabled);
  const zelleAvailable = !trialBlocked && Boolean(settings.zelle_recipient);

  if (request.method === "GET") {
    return json({
      businessName: settings.business_name || "the shop",
      roNumber: ro.ro_number,
      amount: total,
      alreadyPaid: Boolean(ro.paid),
      methods: { card: cardAvailable, zelle: zelleAvailable },
    });
  }

  if (ro.paid) return json({ error: "This invoice has already been paid." }, 409);
  if (total <= 0) return json({ error: "This invoice has nothing to charge." }, 400);

  if (method === "zelle") {
    if (!zelleAvailable) return json({ error: "Zelle isn't available for this invoice." }, 400);
    const zelleToken = generateToken();
    const insert = await fetch(`${supabaseUrl}/rest/v1/payments`, {
      method: "POST",
      headers: { ...serviceHeaders, Prefer: "return=representation" },
      body: JSON.stringify({
        owner_id: link.owner_id, repair_order_id: ro.id, processor: "zelle", amount: total, currency: "usd",
        status: "pending", token_hash: await hashToken(zelleToken),
      }),
    });
    if (!insert.ok) return json({ error: "Could not start your Zelle payment. Please try again." }, 500);
    return json({ url: new URL(`/pay-zelle?token=${zelleToken}`, siteUrl).toString() });
  }

  if (method === "card") {
    if (!cardAvailable || !stripeSecretKey || !settings.stripe_account_id) return json({ error: "Card and bank payment isn't available for this invoice." }, 400);
    const roDigits = String(ro.ro_number).padStart(4, "0");
    const businessName = settings.business_name || "";
    const statusParams = `ro_number=${roDigits}${businessName ? `&business=${encodeURIComponent(businessName)}` : ""}`;
    const sessionParams = new URLSearchParams({
      mode: "payment",
      "payment_method_types[0]": "card",
      "payment_method_types[1]": "us_bank_account",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(Math.round(total * 100)),
      "line_items[0][price_data][product_data][name]": `Invoice #${roDigits}${businessName ? ` — ${businessName}` : ""}`,
      success_url: new URL(`/payment-status?status=success&${statusParams}`, siteUrl).toString(),
      cancel_url: new URL(`/pay?token=${encodeURIComponent(token)}`, siteUrl).toString(),
      "metadata[repair_order_id]": ro.id,
      "metadata[owner_id]": link.owner_id,
    });
    if (ro.customers?.email) sessionParams.set("customer_email", ro.customers.email);

    const sessionResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${stripeSecretKey}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Account": settings.stripe_account_id },
      body: sessionParams,
    });
    const session = await sessionResponse.json() as { id?: string; url?: string; error?: { message?: string } };
    if (!sessionResponse.ok || !session.id || !session.url) return json({ error: "Could not start checkout. Please try again." }, 400);

    const paymentInsert = await fetch(`${supabaseUrl}/rest/v1/payments`, {
      method: "POST",
      headers: { ...serviceHeaders, Prefer: "return=representation" },
      body: JSON.stringify({
        owner_id: link.owner_id, repair_order_id: ro.id, processor: "stripe", processor_account_id: settings.stripe_account_id,
        processor_session_id: session.id, amount: total, currency: "usd", status: "pending",
      }),
    });
    if (!paymentInsert.ok) {
      // A live session we can't track would never mark the invoice paid — expire it rather than leave it payable.
      try {
        await fetch(`https://api.stripe.com/v1/checkout/sessions/${session.id}/expire`, {
          method: "POST",
          headers: { Authorization: `Bearer ${stripeSecretKey}`, "Stripe-Account": settings.stripe_account_id },
        });
      } catch {
        // Best-effort; the session self-expires on Stripe's side within 24h.
      }
      return json({ error: "Could not start checkout. Please try again." }, 500);
    }
    return json({ url: session.url });
  }

  return json({ error: "Choose how you'd like to pay." }, 400);
}

export default async (request: Request) => {
  try {
    return await handler(request);
  } catch (error) {
    await notifyError("pay-invoice", error, request);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};
