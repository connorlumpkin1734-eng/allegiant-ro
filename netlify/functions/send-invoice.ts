// Emails a repair order's invoice to the customer — fully self-service when the shop has a
// payment method connected:
//  - If the shop has connected Stripe and finished onboarding (stripe_charges_enabled), and the
//    invoice is unpaid, this creates a fresh Stripe Checkout session on the shop's own connected
//    account and includes a "Pay now" button in the email (card, Apple Pay, Google Pay all ride
//    on this one link) — same flow as the "Collect payment" button, just delivered by email
//    instead of a link the shop copies themselves.
//  - If the shop has a Zelle recipient set in Settings, this also generates a one-time Zelle
//    claim link (same token/hash pattern as request-zelle-payment.ts) and includes a "Pay via
//    Zelle" button alongside the Stripe one. Nothing about Zelle is ever auto-confirmed — a human
//    still has to click "Confirm payment received" in the app after checking the bank account.
//  - Both are skipped during the free trial (settings.subscription_status === "trialing"), same
//    rule as create-payment-session.ts and request-zelle-payment.ts — an emailed invoice must not
//    be able to hand out a live pay link the in-app buttons are themselves blocked from creating.
//  - If the shop has neither connected, the email still sends with the itemized invoice and
//    balance due, just without a payment button. The shop collects payment however they normally
//    do and marks the invoice paid in the app.
// The charged/shown total mirrors authorizedLineItems()/repairOrderTotal() in app/page.tsx:
// declined jobs are excluded unless the shop separately recorded authorization for them
// (invoice_overrides). Keep this in sync with that logic and with create-payment-session.ts /
// request-zelle-payment.ts.

const STRIPE_API_VERSION_HEADER = "application/x-www-form-urlencoded";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type LineItem = {
  description: string;
  quantity: number;
  unit_price: number;
  taxable: boolean;
  service_group_id: string | null;
  service_group_title: string | null;
  sort_order: number;
};
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
  created_at: string;
  paid: boolean;
  invoice_overrides: InvoiceOverrides | null;
  customers: { name: string | null; email: string | null } | null;
  vehicles: { year: number | null; make: string | null; model: string | null; vin: string | null } | null;
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

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(request.url).origin;
  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", supabaseUrl],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publicKey],
    ["SUPABASE_SERVICE_ROLE_KEY", serviceKey],
    ["RESEND_API_KEY", resendKey],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    return json({ error: `Invoice email is missing Netlify variable${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.` }, 500);
  }
  if (!supabaseUrl || !publicKey || !serviceKey || !resendKey) {
    return json({ error: "Invoice email configuration could not be loaded." }, 500);
  }

  const authHeader = request.headers.get("authorization") || "";
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: authHeader },
  });
  if (!userResponse.ok) return json({ error: "Sign in again before emailing the invoice." }, 401);
  const caller = await userResponse.json() as { id: string };
  const body = await request.json().catch(() => ({})) as { repairOrderId?: string };
  if (!body.repairOrderId) return json({ error: "Missing repair order." }, 400);

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  // Resolve the caller to a shop (owner_id): either the owner themselves, or staff (advisor/admin)
  // acting on behalf of their shop. Same permission rule as collecting payment.
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
      return json({ error: "Only the shop owner or a service advisor can email an invoice." }, 403);
    }
    ownerId = staff.owner_id;
  }

  const settingsResponse = await fetch(`${supabaseUrl}/rest/v1/settings?select=*&owner_id=eq.${ownerId}&limit=1`, { headers: serviceHeaders });
  const settings = (settingsResponse.ok ? await settingsResponse.json() as Array<Record<string, unknown>> : [])[0] || {};

  const roResponse = await fetch(
    `${supabaseUrl}/rest/v1/repair_orders?select=id,owner_id,ro_number,tax_rate,created_at,paid,invoice_overrides,customers(name,email),vehicles(year,make,model,vin),line_items(description,quantity,unit_price,taxable,service_group_id,service_group_title,sort_order)&id=eq.${encodeURIComponent(body.repairOrderId)}&owner_id=eq.${ownerId}`,
    { headers: serviceHeaders }
  );
  const roRows = roResponse.ok ? await roResponse.json() as RepairOrderRow[] : [];
  const ro = roRows[0];
  if (!ro) return json({ error: "Repair order not found." }, 404);
  const customerEmail = ro.customers?.email?.trim();
  if (!customerEmail) return json({ error: "Add the customer's email address before sending." }, 400);

  const authorizationResponse = await fetch(
    `${supabaseUrl}/rest/v1/estimate_authorizations?select=status,line_decisions&repair_order_id=eq.${encodeURIComponent(ro.id)}&order=sent_at.desc&limit=1`,
    { headers: serviceHeaders }
  );
  const authorizationRows = authorizationResponse.ok ? await authorizationResponse.json() as EstimateAuthorization[] : [];
  const estimateAuthorization = authorizationRows[0] ?? null;
  const wasAdjustedForDeclines = hasAuthorizationResponse(estimateAuthorization)
    && Object.values(estimateAuthorization.line_decisions ?? {}).includes("declined");

  const allItems = [...(ro.line_items || [])].sort((a, b) => a.sort_order - b.sort_order);
  const items = authorizedLineItems(allItems, estimateAuthorization, ro.invoice_overrides ?? {});
  const subtotal = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price), 0);
  const taxableAmount = items.reduce((sum, item) => sum + (item.taxable ? Number(item.quantity) * Number(item.unit_price) : 0), 0);
  const tax = Math.max(0, taxableAmount) * (Number(ro.tax_rate) / 100);
  const total = subtotal + tax;

  const roNumberDigits = String(ro.ro_number).padStart(4, "0");
  const roNumberLabel = `#${roNumberDigits}`;
  const businessName = (settings.business_name as string) || "Allegiant Auto Care";
  // Shared platform sending domain: every shop sends from the same verified address (so we're not
  // starting sender reputation from zero per tenant), but the display name is the shop's own name,
  // and Reply-To routes the customer's reply to the shop's real inbox, not this platform mailbox.
  const fromEmail = `${businessName} <invoices@allegiantautocare.com>`;
  const replyToEmail = (settings.business_email as string) || undefined;
  const logoPath = settings.logo_path as string | null | undefined;
  const logoUrl = logoPath ? `${supabaseUrl}/storage/v1/object/public/shop-branding/${logoPath}` : null;
  const primaryColor = (settings.primary_color as string) || "#2459a9";
  const accentColor = (settings.accent_color as string) || "#b5222d";
  const stripeAccountId = settings.stripe_account_id as string | null;
  const stripeChargesEnabled = Boolean(settings.stripe_charges_enabled);
  const zelleRecipient = settings.zelle_recipient as string | null;
  // No customer payment processing during the free trial, full stop — matches the same rule in
  // create-payment-session.ts and request-zelle-payment.ts. An emailed invoice must not be able to
  // hand out a live pay link that the in-app buttons are themselves blocked from creating.
  const trialBlocked = settings.subscription_status === "trialing";

  // Only build a Stripe pay link when the shop actually uses Stripe and there's something owed.
  // Shops that don't connect Stripe still get a clean emailed invoice — just no payment button.
  let payNowUrl: string | null = null;
  if (!ro.paid && total > 0 && !trialBlocked && stripeSecretKey && stripeAccountId && stripeChargesEnabled) {
    try {
      const amountCents = Math.round(total * 100);
      const statusParams = `ro_number=${roNumberDigits}&business=${encodeURIComponent(businessName)}`;
      const successUrl = new URL(`/payment-status?status=success&${statusParams}`, siteUrl).toString();
      const cancelUrl = new URL(`/payment-status?status=canceled&${statusParams}`, siteUrl).toString();
      const sessionParams = new URLSearchParams({
        mode: "payment",
        "payment_method_types[0]": "card",
        "payment_method_types[1]": "us_bank_account",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(amountCents),
        "line_items[0][price_data][product_data][name]": `Invoice ${roNumberLabel} — ${businessName}`,
        success_url: successUrl,
        cancel_url: cancelUrl,
        "metadata[repair_order_id]": ro.id,
        "metadata[owner_id]": ownerId,
        customer_email: customerEmail,
      });
      const sessionResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          "Content-Type": STRIPE_API_VERSION_HEADER,
          "Stripe-Account": stripeAccountId,
        },
        body: sessionParams,
      });
      const session = await sessionResponse.json() as { id?: string; url?: string; error?: { message?: string } };
      if (sessionResponse.ok && session.id && session.url) {
        payNowUrl = session.url;
        await fetch(`${supabaseUrl}/rest/v1/payments`, {
          method: "POST",
          headers: { ...serviceHeaders, Prefer: "return=representation" },
          body: JSON.stringify({
            owner_id: ownerId,
            repair_order_id: ro.id,
            processor: "stripe",
            processor_account_id: stripeAccountId,
            processor_session_id: session.id,
            amount: total,
            currency: "usd",
            status: "pending",
          }),
        });
      }
      // If Stripe session creation fails, fall through and send the invoice without a pay link
      // rather than blocking the email entirely.
    } catch {
      payNowUrl = null;
    }
  }

  // Same idea for Zelle: generate a claim link the customer can use straight from the email,
  // mirroring request-zelle-payment.ts. Nothing here ever marks the invoice paid — only staff
  // clicking "Confirm payment received" does that, same as the in-app flow.
  let zelleUrl: string | null = null;
  if (!ro.paid && total > 0 && !trialBlocked && zelleRecipient) {
    try {
      const token = generateToken();
      const tokenHash = await hashToken(token);
      const zellePaymentInsert = await fetch(`${supabaseUrl}/rest/v1/payments`, {
        method: "POST",
        headers: { ...serviceHeaders, Prefer: "return=representation" },
        body: JSON.stringify({
          owner_id: ownerId,
          repair_order_id: ro.id,
          processor: "zelle",
          amount: total,
          currency: "usd",
          status: "pending",
          token_hash: tokenHash,
        }),
      });
      if (zellePaymentInsert.ok) {
        zelleUrl = new URL(`/pay-zelle?token=${token}`, siteUrl).toString();
      }
      // If recording the Zelle payment fails, fall through and send the invoice without that
      // link rather than blocking the email entirely — same posture as the Stripe branch above.
    } catch {
      zelleUrl = null;
    }
  }

  const money = (amount: number) => amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const vehicle = [ro.vehicles?.year, ro.vehicles?.make, ro.vehicles?.model].filter(Boolean).join(" ");
  const customerName = ro.customers?.name || "Customer";
  const brandHeader = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(businessName)}" style="max-height:48px;max-width:280px;display:block" />`
    : `<h1 style="margin:0">${escapeHtml(businessName)}</h1>`;

  const itemRows = items.map((item) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eef1f6">${escapeHtml(item.service_group_title || item.description)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eef1f6;text-align:right;white-space:nowrap">${money(Number(item.quantity) * Number(item.unit_price))}</td>
    </tr>`).join("");

  const balanceSection = ro.paid
    ? `<div style="background:#e7f7ee;border-left:6px solid #1c8a4f;padding:18px;margin:22px 0">
         <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#1c8a4f">Paid in full</div>
         <div style="font-size:30px;font-weight:800;margin-top:5px">${money(total)}</div>
       </div>`
    : `<div style="background:#fff4e5;border-left:6px solid ${escapeHtml(accentColor)};padding:18px;margin:22px 0">
         <div style="font-size:12px;font-weight:700;text-transform:uppercase">Balance due</div>
         <div style="font-size:30px;font-weight:800;margin-top:5px">${money(total)}</div>
       </div>`;

  const payButton = payNowUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:22px 0 10px"><tr><td bgcolor="${escapeHtml(accentColor)}" style="border-radius:8px"><a href="${escapeHtml(payNowUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:${escapeHtml(accentColor)};color:#ffffff;text-decoration:none;padding:15px 22px;border-radius:8px;font-weight:700">Pay now (card / Apple Pay / Google Pay)</a></td></tr></table>
       <p style="color:#64748b;font-size:13px">If the button does not open, tap or copy this secure link:</p>
       <p style="font-size:13px;line-height:1.5;overflow-wrap:anywhere;word-break:break-all"><a href="${escapeHtml(payNowUrl)}" target="_blank" rel="noopener noreferrer" style="color:${escapeHtml(primaryColor)}">${escapeHtml(payNowUrl)}</a></p>`
    : "";

  const zelleButton = zelleUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:${payNowUrl ? "4px" : "22px"} 0 10px"><tr><td bgcolor="#ffffff" style="border-radius:8px;border:2px solid ${escapeHtml(primaryColor)}"><a href="${escapeHtml(zelleUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;color:${escapeHtml(primaryColor)};text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:700">Pay via Zelle</a></td></tr></table>
       <p style="color:#64748b;font-size:13px">If the button does not open, tap or copy this secure link:</p>
       <p style="font-size:13px;line-height:1.5;overflow-wrap:anywhere;word-break:break-all"><a href="${escapeHtml(zelleUrl)}" target="_blank" rel="noopener noreferrer" style="color:${escapeHtml(primaryColor)}">${escapeHtml(zelleUrl)}</a></p>`
    : "";

  const noPaymentLinkNote = !payNowUrl && !zelleUrl && !ro.paid
    ? `<p style="color:#64748b;font-size:13px">Please contact us to arrange payment.</p>`
    : "";

  const declinedNote = wasAdjustedForDeclines
    ? `<p style="color:#64748b;font-size:13px">Some recommended services were declined and are not included in this total.</p>`
    : "";

  const html = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#102a4c;border:1px solid #d9e0ea;border-radius:12px;overflow:hidden">
    <div style="padding:24px;border-bottom:5px solid ${escapeHtml(primaryColor)}">${brandHeader}<p style="margin:6px 0 0;color:#64748b">Invoice ${roNumberLabel} · ${escapeHtml(vehicle)}</p></div>
    <div style="padding:24px">
      <p>Hi ${escapeHtml(customerName)},</p>
      <p>${ro.paid ? "Here's a copy of your paid invoice." : "Your invoice is ready."}</p>
      ${balanceSection}
      ${payButton}
      ${zelleButton}
      ${noPaymentLinkNote}
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:22px 0;font-size:14px">${itemRows}</table>
      ${declinedNote}
      <p style="color:#64748b;font-size:13px">${escapeHtml(businessName)}${settings.business_phone ? ` · ${escapeHtml(settings.business_phone as string)}` : ""}${settings.business_email ? ` · ${escapeHtml(settings.business_email as string)}` : ""}</p>
    </div>
  </div>`;

  const text = `Hi ${customerName},\n\n${ro.paid ? "Here's a copy of your paid invoice" : "Your invoice is ready"} for ${vehicle} (Invoice ${roNumberLabel}).\n\n${ro.paid ? "Paid" : "Balance due"}: ${money(total)}\n${payNowUrl ? `\nPay now (card / Apple Pay / Google Pay): ${payNowUrl}\n` : ""}${zelleUrl ? `\nPay via Zelle: ${zelleUrl}\n` : ""}\n${businessName}`;

  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [customerEmail],
      ...(replyToEmail ? { reply_to: replyToEmail } : {}),
      subject: `Invoice ${roNumberLabel} from ${businessName}${ro.paid ? " — Paid" : ""}`,
      text,
      html,
    }),
  });
  if (!emailResponse.ok) {
    return json({ error: `Resend rejected the email: ${await emailResponse.text()}` }, 502);
  }

  return json({ message: `Invoice emailed to ${customerEmail}.`, payNowIncluded: Boolean(payNowUrl), zelleIncluded: Boolean(zelleUrl) });
};
