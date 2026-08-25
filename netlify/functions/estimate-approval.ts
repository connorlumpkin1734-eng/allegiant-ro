const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
type Decision = "approved" | "declined";
type SnapshotItem = { quantity: number; unit_price: number; taxable?: boolean; service_group_id?: string | null };
type Snapshot = { items?: SnapshotItem[]; taxRate?: number; photos?: Array<Record<string, unknown>> };

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default async (request: Request) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json({ error: "Estimate approval is not configured." }, 500);
  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const url = new URL(request.url);
  const body = request.method === "POST" ? await request.json().catch(() => ({})) as { token?: string; decisions?: Record<string, Decision>; signerName?: string; signatureData?: string; consent?: boolean } : {};
  const token = request.method === "GET" ? url.searchParams.get("token") : body.token;
  if (!token || token.length < 32) return json({ error: "This approval link is invalid." }, 400);
  const tokenHash = await hashToken(token);
  const lookup = await fetch(`${supabaseUrl}/rest/v1/estimate_authorizations?select=id,repair_order_id,status,customer_name,estimate_snapshot,line_decisions,approved_total,responded_at&token_hash=eq.${tokenHash}&limit=1`, { headers: serviceHeaders });
  const authorization = (await lookup.json() as Array<Record<string, unknown>>)[0];
  if (!authorization) return json({ error: "This approval link is invalid or expired." }, 404);
  if (request.method === "GET") {
    const snapshot = authorization.estimate_snapshot as Snapshot;
    if (snapshot?.photos?.length) snapshot.photos = await Promise.all(snapshot.photos.map(async (photo) => {
      const signResponse = await fetch(`${supabaseUrl}/storage/v1/object/sign/estimate-photos/${photo.storage_path}`, { method: "POST", headers: serviceHeaders, body: JSON.stringify({ expiresIn: 3600 }) });
      const signed = signResponse.ok ? await signResponse.json() as { signedURL?: string; signedUrl?: string } : {};
      const signedPath = signed.signedURL || signed.signedUrl;
      return { ...photo, url: signedPath ? `${supabaseUrl}/storage/v1${signedPath}` : null };
    }));
    return json({ authorization: { ...authorization, estimate_snapshot: snapshot } });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (authorization.status !== "sent") return json({ error: `This estimate was already ${authorization.status}.` }, 409);

  const snapshot = authorization.estimate_snapshot as Snapshot;
  const items = snapshot.items ?? [];
  const groupIds = [...new Set(items.map((item) => item.service_group_id).filter((id): id is string => Boolean(id)))];
  const decisions = body.decisions ?? {};
  if (!groupIds.length || groupIds.some((id) => !["approved", "declined"].includes(decisions[id]))) return json({ error: "Choose approve or decline for every service." }, 400);
  const approvedGroups = groupIds.filter((id) => decisions[id] === "approved");
  const approvedItems = items.filter((item) => item.service_group_id ? decisions[item.service_group_id] === "approved" : approvedGroups.length > 0);
  const subtotal = approvedItems.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price), 0);
  const taxable = approvedItems.reduce((sum, item) => sum + (item.taxable ? Number(item.quantity) * Number(item.unit_price) : 0), 0);
  const approvedTotal = Math.round((subtotal + Math.max(0, taxable) * (Number(snapshot.taxRate || 0) / 100)) * 100) / 100;
  const status = approvedGroups.length === 0 ? "declined" : approvedGroups.length === groupIds.length ? "approved" : "partially_approved";
  if (approvedGroups.length > 0 && (!body.signerName?.trim() || !body.signatureData || !body.consent)) return json({ error: "Enter your name, sign, and accept the authorization statement." }, 400);

  const now = new Date().toISOString();
  const update = await fetch(`${supabaseUrl}/rest/v1/estimate_authorizations?id=eq.${authorization.id}&status=eq.sent`, {
    method: "PATCH", headers: { ...serviceHeaders, Prefer: "return=representation" },
    body: JSON.stringify({ status, line_decisions: decisions, approved_total: approvedTotal, customer_name: body.signerName?.trim() || null, signature_data: approvedGroups.length > 0 ? body.signatureData : null, consent_accepted: approvedGroups.length > 0 ? Boolean(body.consent) : false, response_ip: request.headers.get("x-nf-client-connection-ip") || request.headers.get("x-forwarded-for") || null, response_user_agent: request.headers.get("user-agent"), responded_at: now }),
  });
  const updated = await update.json() as unknown[];
  if (!update.ok || !updated.length) return json({ error: "This estimate has already been answered." }, 409);
  await fetch(`${supabaseUrl}/rest/v1/repair_orders?id=eq.${authorization.repair_order_id}`, { method: "PATCH", headers: serviceHeaders, body: JSON.stringify({ estimate_status: status, estimate_responded_at: now }) });
  return json({ status, approvedTotal });
};
