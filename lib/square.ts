// Square as a card processor for a shop. Each shop links its OWN Square account through OAuth;
// payments land in that account and Square charges the shop its own fees. ROrunner only creates
// payment links for invoices and reads whether they were paid. Tokens live in the server-only
// square_connections table.
//
// Netlify settings: SQUARE_APPLICATION_ID, SQUARE_APPLICATION_SECRET, SQUARE_ENVIRONMENT
// ("sandbox" or "production"), and SQUARE_WEBHOOK_SIGNATURE_KEY for the webhook.

export const SQUARE_SCOPES = ["MERCHANT_PROFILE_READ", "PAYMENTS_READ", "PAYMENTS_WRITE", "ORDERS_READ", "ORDERS_WRITE"];

export function squareConfig() {
  const applicationId = process.env.SQUARE_APPLICATION_ID || "";
  const applicationSecret = process.env.SQUARE_APPLICATION_SECRET || "";
  const sandbox = (process.env.SQUARE_ENVIRONMENT || "sandbox").toLowerCase() !== "production";
  return {
    applicationId,
    applicationSecret,
    sandbox,
    configured: Boolean(applicationId && applicationSecret),
    base: sandbox ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com",
  };
}

type ServiceContext = { supabaseUrl: string; serviceHeaders: Record<string, string> };

type Connection = { owner_id: string; merchant_id: string; access_token: string; refresh_token: string | null; expires_at: string | null };

export type TokenResponse = {
  access_token?: string; refresh_token?: string; expires_at?: string; merchant_id?: string;
  message?: string; errors?: Array<{ detail?: string; code?: string }>;
};

export async function squareTokenRequest(body: Record<string, string>): Promise<TokenResponse & { ok: boolean }> {
  const config = squareConfig();
  const response = await fetch(`${config.base}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: config.applicationId, client_secret: config.applicationSecret, ...body }),
  });
  const data = await response.json().catch(() => ({})) as TokenResponse;
  return { ...data, ok: response.ok && Boolean(data.access_token) };
}

// The shop's current access token, refreshed when it's within 5 days of expiring (Square tokens
// last 30 days). Returns null when the shop has no Square connection or the refresh failed.
export async function squareAccessToken(ctx: ServiceContext, ownerId: string): Promise<{ token: string; merchantId: string } | null> {
  const response = await fetch(`${ctx.supabaseUrl}/rest/v1/square_connections?select=*&owner_id=eq.${ownerId}&limit=1`, { headers: ctx.serviceHeaders });
  const connection = (response.ok ? await response.json() as Connection[] : [])[0];
  if (!connection) return null;

  const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : Infinity;
  if (expiresAt - Date.now() > 5 * 24 * 60 * 60 * 1000) {
    return { token: connection.access_token, merchantId: connection.merchant_id };
  }
  if (!connection.refresh_token) return null;
  const refreshed = await squareTokenRequest({ grant_type: "refresh_token", refresh_token: connection.refresh_token });
  if (!refreshed.ok || !refreshed.access_token) return null;
  await fetch(`${ctx.supabaseUrl}/rest/v1/square_connections?owner_id=eq.${ownerId}`, {
    method: "PATCH",
    headers: ctx.serviceHeaders,
    body: JSON.stringify({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || connection.refresh_token,
      expires_at: refreshed.expires_at || null,
      updated_at: new Date().toISOString(),
    }),
  });
  return { token: refreshed.access_token, merchantId: connection.merchant_id };
}

export async function squareApi<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ ok: boolean; status: number; data: T & { errors?: Array<{ detail?: string; code?: string }> } }> {
  const config = squareConfig();
  const response = await fetch(`${config.base}${path}`, {
    method: init.method || "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await response.json().catch(() => ({})) as T & { errors?: Array<{ detail?: string; code?: string }> };
  return { ok: response.ok, status: response.status, data };
}

export function squareErrorText(data: { errors?: Array<{ detail?: string; code?: string }> }, fallback: string) {
  return data.errors?.[0]?.detail || fallback;
}

// Which card processor a shop's invoices use right now. A shop picks one in Settings
// (card_processor); if that one isn't usable, fall back to whichever is.
export type CardSettings = {
  stripe_account_id?: string | null;
  stripe_charges_enabled?: boolean | null;
  square_location_id?: string | null;
  card_processor?: string | null;
};
export function activeCardProcessor(settings: CardSettings): "stripe" | "square" | null {
  const stripeReady = Boolean(process.env.STRIPE_SECRET_KEY && settings.stripe_account_id && settings.stripe_charges_enabled);
  const squareReady = Boolean(squareConfig().configured && settings.square_location_id);
  if (settings.card_processor === "square" && squareReady) return "square";
  if (settings.card_processor === "stripe" && stripeReady) return "stripe";
  return stripeReady ? "stripe" : squareReady ? "square" : null;
}
export const CARD_SETTINGS_COLUMNS = "stripe_account_id,stripe_charges_enabled,square_location_id,card_processor";

export function cardMethodsLabel(processor: "stripe" | "square" | null) {
  return processor === "stripe" ? "card or bank transfer" : processor === "square" ? "card" : "";
}

type SquarePayment = {
  id: string;
  status?: string;
  order_id?: string;
  amount_money?: { amount?: number };
  total_money?: { amount?: number };
  processing_fee?: Array<{ amount_money?: { amount?: number } }>;
  source_type?: string;
};

function methodFromSource(source?: string) {
  if (!source) return null;
  if (source === "CARD") return "card";
  if (source === "BANK_ACCOUNT") return "us_bank_account";
  return source.toLowerCase();
}

// Records a completed Square payment against our pending payments row (matched by the Square
// order id saved in processor_session_id) and marks the RO paid. Safe to call more than once.
// Refuses to mark paid if Square collected less than the invoice amount.
export async function recordSquarePayment(ctx: ServiceContext, payment: SquarePayment): Promise<"paid" | "ignored"> {
  if (!payment.order_id || payment.status !== "COMPLETED") return "ignored";
  const rowsResponse = await fetch(
    `${ctx.supabaseUrl}/rest/v1/payments?select=id,repair_order_id,amount,status,fee_amount&processor=eq.square&processor_session_id=eq.${encodeURIComponent(payment.order_id)}&limit=1`,
    { headers: ctx.serviceHeaders }
  );
  const row = (rowsResponse.ok ? await rowsResponse.json() as Array<{ id: string; repair_order_id: string; amount: number; status: string; fee_amount: number | null }> : [])[0];
  if (!row) return "ignored";

  const paidCents = Number(payment.total_money?.amount ?? payment.amount_money?.amount ?? 0);
  if (paidCents < Math.round(Number(row.amount) * 100)) return "ignored";

  const feeCents = (payment.processing_fee || []).reduce((sum, fee) => sum + Number(fee.amount_money?.amount || 0), 0);
  const update: Record<string, unknown> = {
    status: "succeeded",
    processor_payment_id: payment.id,
    payment_method_type: methodFromSource(payment.source_type),
  };
  if (payment.processing_fee?.length) {
    update.fee_amount = feeCents / 100;
    update.net_amount = (paidCents - feeCents) / 100;
  }
  await fetch(`${ctx.supabaseUrl}/rest/v1/payments?id=eq.${row.id}`, {
    method: "PATCH", headers: ctx.serviceHeaders, body: JSON.stringify(update),
  });
  if (row.status !== "succeeded") {
    await fetch(`${ctx.supabaseUrl}/rest/v1/repair_orders?id=eq.${row.repair_order_id}&paid=is.false`, {
      method: "PATCH", headers: ctx.serviceHeaders, body: JSON.stringify({ paid: true, paid_at: new Date().toISOString() }),
    });
  }
  return "paid";
}

// Creates a Square payment link for an invoice on the shop's own Square account and records a
// pending payments row the webhook (or the return check) will complete.
export async function createSquareCheckout(ctx: ServiceContext, args: {
  ownerId: string; repairOrderId: string; locationId: string; total: number; name: string;
  buyerEmail?: string | null; siteUrl: string; statusParams: string;
}): Promise<{ url: string } | { error: string }> {
  const access = await squareAccessToken(ctx, args.ownerId);
  if (!access) return { error: "The shop's Square connection needs to be reconnected." };

  const insert = await fetch(`${ctx.supabaseUrl}/rest/v1/payments`, {
    method: "POST",
    headers: { ...ctx.serviceHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      owner_id: args.ownerId, repair_order_id: args.repairOrderId, processor: "square",
      processor_account_id: access.merchantId, amount: args.total, currency: "usd", status: "pending",
    }),
  });
  const row = (insert.ok ? await insert.json() as Array<{ id: string }> : [])[0];
  if (!row) return { error: "Could not start checkout. Please try again." };

  const redirectUrl = new URL(`/payment-status?status=success&${args.statusParams}&square_payment=${row.id}`, args.siteUrl).toString();
  const link = await squareApi<{ payment_link?: { id: string; url: string; order_id: string } }>(access.token, "/v2/online-checkout/payment-links", {
    method: "POST",
    body: {
      idempotency_key: row.id,
      quick_pay: {
        name: args.name.slice(0, 255),
        price_money: { amount: Math.round(args.total * 100), currency: "USD" },
        location_id: args.locationId,
      },
      checkout_options: { redirect_url: redirectUrl, ask_for_shipping_address: false },
      ...(args.buyerEmail ? { pre_populated_data: { buyer_email: args.buyerEmail } } : {}),
      payment_note: args.name.slice(0, 500),
    },
  });
  const paymentLink = link.data.payment_link;
  if (!link.ok || !paymentLink?.url || !paymentLink.order_id) {
    await fetch(`${ctx.supabaseUrl}/rest/v1/payments?id=eq.${row.id}`, {
      method: "PATCH", headers: ctx.serviceHeaders, body: JSON.stringify({ status: "failed", failure_message: squareErrorText(link.data, "Square checkout failed.") }),
    });
    return { error: "Could not start checkout. Please try again." };
  }
  await fetch(`${ctx.supabaseUrl}/rest/v1/payments?id=eq.${row.id}`, {
    method: "PATCH", headers: ctx.serviceHeaders,
    body: JSON.stringify({ processor_session_id: paymentLink.order_id, metadata: { square_payment_link_id: paymentLink.id } }),
  });
  return { url: paymentLink.url };
}

// Looks up a Square order and records it as paid if Square says it was. Used when the customer
// lands back from Square checkout, so the invoice flips to paid without waiting on the webhook.
export async function checkSquareOrder(ctx: ServiceContext, ownerId: string, orderId: string): Promise<"paid" | "ignored"> {
  const access = await squareAccessToken(ctx, ownerId);
  if (!access) return "ignored";
  const order = await squareApi<{ order?: { tenders?: Array<{ payment_id?: string }> } }>(access.token, `/v2/orders/${encodeURIComponent(orderId)}`);
  const paymentIds = (order.data.order?.tenders || []).map((tender) => tender.payment_id).filter(Boolean) as string[];
  for (const paymentId of paymentIds) {
    const payment = await squareApi<{ payment?: SquarePayment }>(access.token, `/v2/payments/${encodeURIComponent(paymentId)}`);
    if (payment.data.payment && await recordSquarePayment(ctx, payment.data.payment) === "paid") return "paid";
  }
  return "ignored";
}
