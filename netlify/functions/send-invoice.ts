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

import { amountBlock, brandFromSettings, emailButton, escapeHtml, lineTable, money, renderCustomerEmail, renderCustomerText, totalsTable, type LineRow } from "../../lib/customer-email";

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
  job_status?: string | null;
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
  // Pending technician requests are never billed; jobs authorized at write-up always are.
  const billable = items.filter((item) => item.job_status !== "pending_review");
  if (!hasAuthorizationResponse(authorization)) return billable;
  const decisions = authorization.line_decisions ?? {};
  const hasApprovedService = Object.values(decisions).includes("approved")
    || billable.some((item) => item.service_group_id && (overrides[item.service_group_id] || item.job_status === "authorized"));
  return billable.filter((item) =>
    item.service_group_id
      ? item.job_status === "authorized" || decisions[item.service_group_id] === "approved" || Boolean(overrides[item.service_group_id])
      : hasApprovedService
  );
}

async function handler(request: Request): Promise<Response> {
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
    `${supabaseUrl}/rest/v1/repair_orders?select=id,owner_id,ro_number,tax_rate,created_at,paid,invoice_overrides,customers(name,email),vehicles(year,make,model,vin),line_items(description,quantity,unit_price,taxable,service_group_id,service_group_title,sort_order,job_status)&id=eq.${encodeURIComponent(body.repairOrderId)}&owner_id=eq.${ownerId}`,
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

  // Video clips can't play inside an email, so when this invoice has any (for services that are on
  // it), save a frozen snapshot behind a token-gated link and add a "Watch your repair videos"
  // button. Best-effort like the pay links: if anything here fails the invoice still sends.
  let videosUrl: string | null = null;
  try {
    const invoiceGroupIds = new Set(items.map((item) => item.service_group_id).filter((id): id is string => Boolean(id)));
    const videoResponse = await fetch(
      `${supabaseUrl}/rest/v1/estimate_videos?select=service_group_id,storage_key,content_type,caption,sort_order&repair_order_id=eq.${encodeURIComponent(ro.id)}&order=sort_order.asc`,
      { headers: serviceHeaders }
    );
    const allVideos = videoResponse.ok ? await videoResponse.json() as Array<{ service_group_id: string; storage_key: string; content_type: string | null; caption: string | null }> : [];
    const invoiceVideos = allVideos.filter((video) => invoiceGroupIds.has(video.service_group_id));
    if (invoiceVideos.length > 0) {
      const groupTitles = new Map(items.filter((item) => item.service_group_id).map((item) => [item.service_group_id as string, item.service_group_title || "Repair video"]));
      const videoToken = generateToken();
      const videoTokenHash = await hashToken(videoToken);
      const shareInsert = await fetch(`${supabaseUrl}/rest/v1/video_share_links`, {
        method: "POST",
        headers: serviceHeaders,
        body: JSON.stringify({
          owner_id: ownerId,
          repair_order_id: ro.id,
          token_hash: videoTokenHash,
          snapshot: {
            roNumber: ro.ro_number,
            customerName: ro.customers?.name || "Customer",
            vehicle: [ro.vehicles?.year, ro.vehicles?.make, ro.vehicles?.model].filter(Boolean).join(" "),
            businessName: (settings.business_name as string) || "Your repair shop",
            businessAddress: (settings.business_address as string) || "",
            businessPhone: (settings.business_phone as string) || "",
            businessEmail: (settings.business_email as string) || "",
            logoUrl: settings.logo_path ? `${supabaseUrl}/storage/v1/object/public/shop-branding/${settings.logo_path as string}` : null,
            primaryColor: (settings.primary_color as string) || "#2459a9",
            accentColor: (settings.accent_color as string) || "#b5222d",
            secondaryColor: (settings.secondary_color as string) || "#10264d",
            videos: invoiceVideos.map((video) => ({
              storage_key: video.storage_key,
              content_type: video.content_type,
              caption: video.caption,
              group_title: groupTitles.get(video.service_group_id) || "Repair video",
            })),
          },
        }),
      });
      if (shareInsert.ok) videosUrl = new URL(`/repair-videos/?token=${videoToken}`, siteUrl).toString();
    }
  } catch {
    videosUrl = null;
  }

  const roNumberDigits = String(ro.ro_number).padStart(4, "0");
  const roNumberLabel = `#${roNumberDigits}`;
  const businessName = (settings.business_name as string) || "Your repair shop";
  // Shared platform sending domain: every shop sends from the same verified address (so we're not
  // starting sender reputation from zero per tenant), but the display name is the shop's own name,
  // and Reply-To routes the customer's reply to the shop's real inbox, not this platform mailbox.
  const fromEmail = `${businessName} <invoices@allegiantautocare.com>`;
  const replyToEmail = (settings.business_email as string) || undefined;
  const stripeAccountId = settings.stripe_account_id as string | null;
  const stripeChargesEnabled = Boolean(settings.stripe_charges_enabled);
  const zelleRecipient = settings.zelle_recipient as string | null;
  // No customer payment processing during the free trial, full stop — matches the same rule in
  // create-payment-session.ts and request-zelle-payment.ts. An emailed invoice must not be able to
  // hand out a live pay link that the in-app buttons are themselves blocked from creating.
  const trialBlocked = settings.subscription_status === "trialing";

  // One "pay this invoice" link: the customer chooses card/bank (Stripe) or Zelle on the public /pay
  // page, which creates the actual Stripe session / Zelle request only when they choose. Nothing
  // here ever marks the invoice paid. If recording the link fails, send the invoice without it
  // rather than blocking the email.
  const canPayByCard = Boolean(stripeSecretKey && stripeAccountId && stripeChargesEnabled);
  const canPayByZelle = Boolean(zelleRecipient);
  let payLinkUrl: string | null = null;
  if (!ro.paid && total > 0 && !trialBlocked && (canPayByCard || canPayByZelle)) {
    try {
      const token = generateToken();
      const linkInsert = await fetch(`${supabaseUrl}/rest/v1/payment_links`, {
        method: "POST",
        headers: { ...serviceHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ owner_id: ownerId, repair_order_id: ro.id, token_hash: await hashToken(token) }),
      });
      if (linkInsert.ok) payLinkUrl = new URL(`/pay?token=${token}`, siteUrl).toString();
    } catch {
      payLinkUrl = null;
    }
  }
  const payMethodsLabel = [canPayByCard && "card or bank transfer", canPayByZelle && "Zelle"].filter(Boolean).join(" or ");

  const brand = brandFromSettings(settings, supabaseUrl);
  const vehicle = [ro.vehicles?.year, ro.vehicles?.make, ro.vehicles?.model].filter(Boolean).join(" ");
  const vehicleText = vehicle || "vehicle";
  const firstName = (ro.customers?.name || "").trim().split(/\s+/)[0] || "there";

  // One row per job (labor and parts added together), then fees/discounts on their own.
  const jobs = new Map<string, { title: string; total: number }>();
  const otherRows: LineRow[] = [];
  for (const item of items) {
    const amount = Number(item.quantity) * Number(item.unit_price);
    if (item.service_group_id) {
      const job = jobs.get(item.service_group_id) ?? { title: item.service_group_title?.trim() || item.description, total: 0 };
      job.total += amount;
      jobs.set(item.service_group_id, job);
    } else {
      otherRows.push({ label: item.description || (amount < 0 ? "Discount" : "Charge"), amount: money(amount) });
    }
  }
  const groups = [
    { heading: "Work performed", rows: [...jobs.values()].map((job) => ({ label: job.title, amount: money(job.total) })) },
    ...(otherRows.length ? [{ heading: "Other charges", rows: otherRows }] : []),
  ].filter((group) => group.rows.length);

  const emailBody = [
    ro.paid
      ? amountBlock("Paid in full", money(total), "#15803d", "Thank you!")
      : amountBlock("Balance due", money(total), brand.primaryColor, payLinkUrl ? `Pay online by ${payMethodsLabel}` : ""),
    payLinkUrl ? `<div style="margin:0 0 26px">${emailButton("Pay now", payLinkUrl, brand.accentColor)}</div>` : "",
    lineTable(groups, brand.primaryColor),
    totalsTable([
      { label: "Subtotal", amount: money(subtotal) },
      ...(tax > 0 ? [{ label: `Tax (${Number(ro.tax_rate)}%)`, amount: money(tax) }] : []),
      { label: ro.paid ? "Total paid" : "Total due", amount: money(total), strong: true },
    ]),
  ].join("");

  const html = renderCustomerEmail({
    brand,
    preheader: ro.paid
      ? `Your paid invoice for your ${vehicleText}. Thanks for your business!`
      : `${money(total)} due for the work on your ${vehicleText}.${payLinkUrl ? " Pay online in a minute." : ""}`,
    documentLabel: `Invoice ${roNumberLabel}`,
    vehicle,
    greeting: `Hi ${firstName},`,
    intro: ro.paid
      ? `Thanks for trusting us with your ${escapeHtml(vehicleText)}. Here&#039;s a copy of your paid invoice for your records.`
      : `Your ${escapeHtml(vehicleText)} is all set. Here&#039;s your invoice for the work we did.`,
    body: emailBody,
    secondaryButton: videosUrl ? { label: "Watch your repair videos", url: videosUrl } : undefined,
    finePrint: [
      !ro.paid && !payLinkUrl ? "Give us a call to arrange payment." : "",
      wasAdjustedForDeclines ? "Services you declined aren&#039;t included in this total." : "",
      videosUrl ? "Your technician recorded video of the work on your vehicle." : "",
    ].filter(Boolean).join(" ") || undefined,
    fallbackUrl: payLinkUrl ?? videosUrl ?? undefined,
  });

  const text = renderCustomerText([
    `Hi ${firstName},`,
    "",
    ro.paid ? `Here's a copy of your paid invoice for your ${vehicleText} (Invoice ${roNumberLabel}).` : `Your invoice for your ${vehicleText} is ready (Invoice ${roNumberLabel}).`,
    "",
    ...[...jobs.values()].map((job) => `- ${job.title}: ${money(job.total)}`),
    ...otherRows.map((row) => `- ${row.label}: ${row.amount}`),
    "",
    `${ro.paid ? "Paid" : "Balance due"}: ${money(total)}`,
    payLinkUrl ? `\nPay now (${payMethodsLabel}): ${payLinkUrl}` : "",
    videosUrl ? `\nWatch your repair videos: ${videosUrl}` : "",
    wasAdjustedForDeclines ? "\nServices you declined aren't included in this total." : "",
  ], brand);

  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [customerEmail],
      ...(replyToEmail ? { reply_to: replyToEmail } : {}),
      subject: ro.paid
        ? `Paid invoice for your ${vehicleText} from ${brand.name}`
        : `Your invoice from ${brand.name}: ${money(total)} due`,
      text,
      html,
    }),
  });
  if (!emailResponse.ok) {
    return json({ error: `Resend rejected the email: ${await emailResponse.text()}` }, 502);
  }

  return json({ message: `Invoice emailed to ${customerEmail}.`, payLinkIncluded: Boolean(payLinkUrl) });
}

export default async (request: Request) => {
  try {
    return await handler(request);
  } catch (error) {
    await notifyError("send-invoice", error, request);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};
