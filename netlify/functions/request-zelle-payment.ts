// Generates a one-time, unguessable link a shop can send to their customer to pay an invoice via
// Zelle. Zelle has no business API — there's nothing to "charge" here, just a payments row that
// records who owes what and a token the public pay-zelle page can look up. Mirrors the
// auth/amount-calculation logic in create-payment-session.ts; keep them in sync if that ever changes.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

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
  line_items: LineItem[];
};

function hasAuthorizationResponse(authorization: EstimateAuthorization | null | undefined): authorization is EstimateAuthorization {
  return Boolean(
    authorization
      && ["approved", "partially_approved", "declined"].includes(authorization.status)
      && Object.keys(authorization.line_decisions ?? {}).length > 0
  );
}

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

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(request.url).origin;
  if (!supabaseUrl || !publicKey || !serviceKey) {
    return json({ error: "Payments configuration could not be loaded." }, 500);
  }

  const authorization = request.headers.get("authorization") || "";
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json({ error: "Sign in again before requesting payment." }, 401);
  const caller = await userResponse.json() as { id: string };
  const body = await request.json().catch(() => ({})) as { repairOrderId?: string };
  if (!body.repairOrderId) return json({ error: "Missing repair order." }, 400);

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

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
      return json({ error: "Only the shop owner or a service advisor can request payment." }, 403);
    }
    ownerId = staff.owner_id;
  }

  const settingsResponse = await fetch(
    `${supabaseUrl}/rest/v1/settings?select=zelle_recipient,business_name,business_email,subscription_status&owner_id=eq.${ownerId}&limit=1`,
    { headers: serviceHeaders }
  );
  const settings = (settingsResponse.ok ? await settingsResponse.json() as Array<{ zelle_recipient: string | null; business_name: string | null; business_email: string | null; subscription_status: string }> : [])[0];
  if (!settings) return json({ error: "Shop settings not found." }, 404);
  if (settings.subscription_status === "trialing") {
    return json({ error: "Payment processing isn't available during the free trial. Subscribe to accept customer payments." }, 403);
  }
  if (!settings.zelle_recipient) return json({ error: "Add a Zelle phone number or email in Settings before requesting Zelle payment." }, 400);

  const roResponse = await fetch(
    `${supabaseUrl}/rest/v1/repair_orders?select=id,owner_id,ro_number,tax_rate,invoice_overrides,line_items(item_type,quantity,unit_price,taxable,service_group_id)&id=eq.${encodeURIComponent(body.repairOrderId)}&owner_id=eq.${ownerId}`,
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

  const token = generateToken();
  const tokenHash = await hashToken(token);

  const paymentInsert = await fetch(`${supabaseUrl}/rest/v1/payments`, {
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
  if (!paymentInsert.ok) {
    return json({ error: `Could not create the Zelle payment request: ${await paymentInsert.text()}` }, 500);
  }

  return json({ url: new URL(`/pay-zelle?token=${token}`, siteUrl).toString(), amount: total });
};
