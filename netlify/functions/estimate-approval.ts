import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
type Decision = "approved" | "declined";
type SnapshotItem = { quantity: number; unit_price: number; taxable?: boolean; service_group_id?: string | null };
type Snapshot = { items?: SnapshotItem[]; taxRate?: number; photos?: Array<Record<string, unknown>>; videos?: Array<Record<string, unknown>> };

function r2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clientIp(request: Request): string {
  return request.headers.get("x-nf-client-connection-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

// Public endpoint, no login required — rate limit by IP so it can't be used to brute-force
// approval tokens or spam this function. Fails open (allows the request) if the rate limiter
// itself is unreachable, so an outage there never blocks a real customer approving an estimate.
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

export default async (request: Request) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json({ error: "Estimate approval is not configured." }, 500);
  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  // GET (viewing the estimate) is capped generously; POST (submitting a decision) is tighter —
  // a legitimate customer only responds once per estimate.
  const ip = clientIp(request);
  const rateLimitKey = `estimate-approval:${request.method}:${ip}`;
  const allowed = request.method === "POST"
    ? await checkRateLimit(supabaseUrl, serviceKey, rateLimitKey, 600, 10)
    : await checkRateLimit(supabaseUrl, serviceKey, rateLimitKey, 600, 60);
  if (!allowed) return json({ error: "Too many requests — please wait a few minutes and try again." }, 429);

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
    if (snapshot?.videos?.length) {
      const client = r2Client();
      const bucket = process.env.R2_VIDEOS_BUCKET;
      // The raw R2 key is deliberately not sent to the customer's browser — only a signed, expiring URL.
      // Four hours covers a customer who opens the link, leaves the video paused, and comes back.
      snapshot.videos = await Promise.all(snapshot.videos.map(async (video) => {
        const { storage_key: storageKey, ...rest } = video;
        let signedUrl: string | null = null;
        if (client && bucket && typeof storageKey === "string") {
          try { signedUrl = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: storageKey }), { expiresIn: 14400 }); }
          catch { signedUrl = null; }
        }
        return { ...rest, url: signedUrl };
      }));
    }
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
