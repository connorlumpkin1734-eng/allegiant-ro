type RepairOrderRow = {
  id: string;
  owner_id: string;
  ro_number: number;
  tax_rate: number;
  created_at: string;
  customer_concern: string | null;
  customers: { name: string; email: string | null } | null;
  vehicles: { year: number | null; make: string | null; model: string | null; vin: string | null } | null;
  line_items: Array<{ item_type: string; description: string; quantity: number; unit_price: number; taxable: boolean; sort_order: number; service_group_id: string | null; service_group_title: string | null; technician_story: string | null; service_concern: string | null; concern_line_id: string | null; job_status: string | null; job_note: string | null }>;
  concern_lines: Array<{ id: string; sort_order: number; kind: string; concern: string | null; cause: string | null }> | null;
};

import { pickRecipient, resolveCustomerSender } from "../../lib/shop-caller";
import { getInspectionShare, inspectionSummaryHtml, type InspectionShare } from "../../lib/inspection-share";
import { amountBlock, brandFromSettings, emailButton, escapeHtml, lineTable, money, renderCustomerEmail, renderCustomerText, totalsTable, type LineRow } from "../../lib/customer-email";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(request.url).origin;
  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", supabaseUrl],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publicKey],
    ["SUPABASE_SERVICE_ROLE_KEY", serviceKey],
    ["RESEND_API_KEY", resendKey],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    return json({ error: `Estimate email is missing Netlify variable${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.` }, 500);
  }
  if (!supabaseUrl || !publicKey || !serviceKey || !resendKey) {
    return json({ error: "Estimate email configuration could not be loaded." }, 500);
  }

  const authorization = request.headers.get("authorization") || "";
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json({ error: "Sign in again before sending an estimate." }, 401);
  const user = await userResponse.json() as { id: string };
  const body = await request.json().catch(() => ({})) as { repairOrderId?: string; includeInspection?: boolean; toEmail?: string };
  if (!body.repairOrderId) return json({ error: "Missing repair order." }, 400);

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  // Owner, service advisor or admin may send; technicians may not.
  const sender = await resolveCustomerSender(supabaseUrl, serviceHeaders, user.id);
  if ("error" in sender) return json({ error: sender.error }, sender.status);
  const ownerId = sender.ownerId;
  const roResponse = await fetch(
    `${supabaseUrl}/rest/v1/repair_orders?select=*,customers(name,email),vehicles(year,make,model,vin),line_items(item_type,description,quantity,unit_price,taxable,sort_order,service_group_id,service_group_title,technician_story,service_concern,concern_line_id,job_status,job_note),concern_lines(id,sort_order,kind,concern,cause)&id=eq.${encodeURIComponent(body.repairOrderId)}&owner_id=eq.${ownerId}`,
    { headers: serviceHeaders }
  );
  const rows = await roResponse.json() as RepairOrderRow[];
  const ro = rows[0];
  if (!ro) return json({ error: "Repair order not found." }, 404);
  // The Send panel can send to a different address than the one on file.
  const recipient = pickRecipient(body.toEmail, ro.customers?.email);
  if ("error" in recipient) return json({ error: recipient.error }, 400);
  const customerEmail = recipient.email;

  const settingsResponse = await fetch(`${supabaseUrl}/rest/v1/settings?select=*&owner_id=eq.${ownerId}&limit=1`, { headers: serviceHeaders });
  const settings = (await settingsResponse.json() as Array<Record<string, unknown>>)[0] || {};
  const photoResponse = await fetch(`${supabaseUrl}/rest/v1/estimate_photos?select=service_group_id,storage_path,caption,sort_order&repair_order_id=eq.${ro.id}&order=sort_order.asc`, { headers: serviceHeaders });
  const photos = photoResponse.ok ? await photoResponse.json() as Array<Record<string, unknown>> : [];
  // Videos are frozen into the snapshot the same way photos are: only their R2 keys are stored here,
  // and estimate-approval signs fresh playback URLs every time the customer opens the link.
  const videoResponse = await fetch(`${supabaseUrl}/rest/v1/estimate_videos?select=service_group_id,storage_key,content_type,caption,sort_order&repair_order_id=eq.${ro.id}&order=sort_order.asc`, { headers: serviceHeaders });
  const videos = videoResponse.ok ? await videoResponse.json() as Array<Record<string, unknown>> : [];
  // Technician requests still pending advisor review are not part of the estimate.
  const items = [...(ro.line_items || [])]
    .filter((item) => item.job_status !== "pending_review")
    .sort((a, b) => a.sort_order - b.sort_order);
  if (!items.some((item) => item.service_group_id)) {
    return json({ error: "Add at least one priced job before sending the estimate (technician requests must be reviewed first)." }, 400);
  }
  // Concern lines (Line A, B, C…) frozen with the estimate, for the customer's approval page.
  const concernLines = [...(ro.concern_lines || [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((line, index) => ({ id: line.id, letter: String.fromCharCode(65 + (index % 26)), kind: line.kind, concern: line.concern, cause: line.cause }));
  const subtotal = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price), 0);
  const taxable = items.reduce((sum, item) => sum + (item.taxable ? Number(item.quantity) * Number(item.unit_price) : 0), 0);
  const tax = Math.max(0, taxable) * (Number(ro.tax_rate) / 100);
  const total = subtotal + tax;
  const logoPath = settings.logo_path as string | null | undefined;
  const logoUrl = logoPath ? `${supabaseUrl}/storage/v1/object/public/shop-branding/${logoPath}` : null;
  const primaryColor = (settings.primary_color as string) || "#2459a9";
  const accentColor = (settings.accent_color as string) || "#b5222d";
  const secondaryColor = (settings.secondary_color as string) || "#10264d";
  // Optional: the RO's multipoint inspection goes along with the estimate, using the same customer
  // link the inspection always has (sending the inspection on its own reuses it too).
  let inspectionShare: InspectionShare | null = null;
  if (body.includeInspection) {
    try {
      inspectionShare = await getInspectionShare({ supabaseUrl, serviceHeaders, repairOrderId: ro.id, ownerId, siteUrl, customerEmail });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Could not attach the inspection report." }, 500);
    }
    if (!inspectionShare) return json({ error: "This RO has no saved inspection to include. Uncheck \"Include inspection\" or save the inspection first." }, 400);
  }
  const snapshot = {
    inspectionUrl: inspectionShare?.url ?? null,
    roNumber: ro.ro_number,
    customerName: ro.customers?.name || "Customer",
    customerEmail,
    vehicle: [ro.vehicles?.year, ro.vehicles?.make, ro.vehicles?.model].filter(Boolean).join(" "),
    vin: ro.vehicles?.vin || "",
    estimateDate: ro.created_at,
    customerConcern: ro.customer_concern || "",
    items,
    concernLines,
    photos,
    videos,
    // The shop's chosen document layout, frozen at send time like everything else in the snapshot.
    template: (settings.document_template as string) || "standard",
    subtotal,
    tax,
    total,
    taxRate: Number(ro.tax_rate),
    businessName: settings.business_name || "Your repair shop",
    businessAddress: settings.business_address || "",
    businessPhone: settings.business_phone || "",
    businessEmail: settings.business_email || "",
    logoUrl,
    primaryColor,
    accentColor,
    secondaryColor,
  };

  // Shared platform sending domain: every shop sends from the same verified address (so we're not
  // starting sender reputation from zero per tenant), but the display name is the shop's own name,
  // and Reply-To routes the customer's reply to the shop's real inbox, not this platform mailbox.
  const fromEmail = `${snapshot.businessName} <estimates@allegiantautocare.com>`;
  const replyToEmail = (settings.business_email as string) || undefined;

  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  const tokenHash = await hashToken(token);
  const approvalLink = new URL("/estimate-approval/", siteUrl);
  approvalLink.searchParams.set("token", token);
  const approvalUrl = approvalLink.toString();

  await fetch(`${supabaseUrl}/rest/v1/estimate_authorizations?repair_order_id=eq.${ro.id}&status=eq.sent`, {
    method: "PATCH", headers: serviceHeaders, body: JSON.stringify({ status: "superseded" }),
  });
  const insertResponse = await fetch(`${supabaseUrl}/rest/v1/estimate_authorizations`, {
    method: "POST", headers: { ...serviceHeaders, Prefer: "return=representation" },
    body: JSON.stringify({ owner_id: ownerId, repair_order_id: ro.id, token_hash: tokenHash, customer_email: customerEmail, estimate_snapshot: snapshot }),
  });
  if (!insertResponse.ok) return json({ error: `Could not create approval request: ${await insertResponse.text()}` }, 500);

  const brand = brandFromSettings(settings, supabaseUrl);
  const estimateLabel = `Estimate #${String(ro.ro_number).padStart(4, "0")}`;
  const firstName = snapshot.customerName.split(/\s+/)[0] || "there";
  const vehicleText = snapshot.vehicle || "vehicle";

  // Jobs grouped under the line they belong to (what the customer asked for / their concern / our
  // recommendation), each with its price, so the customer sees what they're paying for up front.
  const jobs = new Map<string, { title: string; total: number; lineId: string | null; authorized: boolean }>();
  const otherCharges: LineRow[] = [];
  for (const item of items) {
    const amount = Number(item.quantity) * Number(item.unit_price);
    if (!item.service_group_id) {
      otherCharges.push({ label: item.description || (amount < 0 ? "Discount" : "Charge"), amount: money(amount) });
      continue;
    }
    const job = jobs.get(item.service_group_id) ?? {
      title: item.service_group_title?.trim() || "Recommended service",
      total: 0,
      lineId: item.concern_line_id,
      authorized: item.job_status === "authorized",
    };
    job.total += amount;
    jobs.set(item.service_group_id, job);
  }
  const kindHeading: Record<string, string> = { request: "You asked for", customer: "Your concern", inspection: "We recommend" };
  const jobRow = (job: { title: string; total: number; authorized: boolean }): LineRow => ({
    label: job.title,
    amount: money(job.total),
    tag: job.authorized ? "Approved" : undefined,
  });
  const groups: Array<{ heading?: string; subheading?: string; rows: LineRow[] }> = [];
  for (const line of concernLines) {
    const lineJobs = [...jobs.values()].filter((job) => job.lineId === line.id);
    if (!lineJobs.length) continue;
    groups.push({
      heading: `${kindHeading[line.kind] ?? "Service"}`,
      subheading: line.concern?.trim() && line.kind !== "inspection" ? line.concern.trim() : undefined,
      rows: lineJobs.map(jobRow),
    });
  }
  const knownLines = new Set(concernLines.map((line) => line.id));
  const looseJobs = [...jobs.values()].filter((job) => !job.lineId || !knownLines.has(job.lineId));
  if (looseJobs.length) groups.push({ heading: groups.length ? "Additional work" : undefined, rows: looseJobs.map(jobRow) });
  if (otherCharges.length) groups.push({ heading: "Other charges", rows: otherCharges });

  const needsApproval = [...jobs.values()].filter((job) => !job.authorized).length;
  const reviewButton = { label: needsApproval ? "Review & approve" : "View your estimate", url: approvalUrl };
  const emailBody = [
    amountBlock("Estimated total", money(total), brand.primaryColor, `${jobs.size} ${jobs.size === 1 ? "service" : "services"}${tax > 0 ? " · tax included" : ""}`),
    `<div style="margin:0 0 26px">${emailButton(reviewButton.label, reviewButton.url, brand.accentColor)}</div>`,
    lineTable(groups, brand.primaryColor),
    totalsTable([
      { label: "Subtotal", amount: money(subtotal) },
      ...(tax > 0 ? [{ label: `Tax (${Number(ro.tax_rate)}%)`, amount: money(tax) }] : []),
      { label: "Estimated total", amount: money(total), strong: true },
    ]),
    inspectionShare
      ? `<div style="margin:26px 0 10px;padding-top:22px;border-top:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:${brand.primaryColor}">Your inspection</div>`
        + inspectionSummaryHtml(inspectionShare)
        + `<div style="margin:0 0 22px">${emailButton("View full inspection", inspectionShare.url, brand.primaryColor, "outline")}</div>`
      : "",
  ].join("");

  const html = renderCustomerEmail({
    brand,
    preheader: `${money(total)} estimate${inspectionShare ? " and inspection" : ""} for your ${vehicleText}. Approve the work you want with one tap.`,
    documentLabel: estimateLabel,
    vehicle: snapshot.vehicle,
    greeting: `Hi ${firstName},`,
    intro: needsApproval
      ? `Here&#039;s the estimate${inspectionShare ? " and inspection results" : ""} for your ${escapeHtml(vehicleText)}. Look it over and approve the work you&#039;d like us to do. You can say yes or no to each item.`
      : `Here&#039;s the estimate for your ${escapeHtml(vehicleText)}, with everything you&#039;ve approved.`,
    body: emailBody,
    primaryButton: jobs.size > 4 ? reviewButton : undefined,
    finePrint: needsApproval
      ? "Photos, videos and full details are on the estimate page. We won&#039;t start anything you haven&#039;t approved."
      : "Photos, videos and full details are on the estimate page.",
    fallbackUrl: approvalUrl,
  });
  const text = renderCustomerText([
    `Hi ${firstName},`,
    "",
    `Here's the estimate for your ${vehicleText} (${estimateLabel}).`,
    "",
    ...[...jobs.values()].map((job) => `- ${job.title}: ${money(job.total)}${job.authorized ? " (approved)" : ""}`),
    ...otherCharges.map((row) => `- ${row.label}: ${row.amount}`),
    "",
    `Estimated total: ${money(total)}`,
    "",
    `Review and approve here: ${approvalUrl}`,
    inspectionShare ? `\nYour inspection (needs attention: ${inspectionShare.needsWork}, keep an eye on: ${inspectionShare.watch}, looks good: ${inspectionShare.good}): ${inspectionShare.url}` : "",
  ], brand);

  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [customerEmail],
      ...(replyToEmail ? { reply_to: replyToEmail } : {}),
      subject: `Your ${vehicleText} estimate${inspectionShare ? " and inspection" : ""} from ${brand.name}: ${money(total)}`,
      text,
      html,
    }),
  });
  if (!emailResponse.ok) {
    await fetch(`${supabaseUrl}/rest/v1/estimate_authorizations?token_hash=eq.${tokenHash}`, { method: "DELETE", headers: serviceHeaders });
    return json({ error: `Resend rejected the email: ${await emailResponse.text()}` }, 502);
  }

  const now = new Date().toISOString();
  await fetch(`${supabaseUrl}/rest/v1/repair_orders?id=eq.${ro.id}`, {
    method: "PATCH", headers: serviceHeaders, body: JSON.stringify({ estimate_status: "sent", estimate_sent_at: now, estimate_responded_at: null }),
  });
  return json({ message: `Estimate${inspectionShare ? " and inspection" : ""} emailed to ${customerEmail}.` });
};
