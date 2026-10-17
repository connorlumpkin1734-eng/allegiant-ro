// Public, token-gated endpoint behind the invoice email's "Watch your repair videos" link.
// Looks up the frozen snapshot saved by send-invoice.ts (keyed by the SHA-256 of the token) and
// returns it with fresh signed R2 playback URLs. The raw R2 key is never sent to the browser.
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

type SnapshotVideo = { storage_key?: string; content_type?: string | null; caption?: string | null; group_title?: string | null };
type Snapshot = { videos?: SnapshotVideo[] } & Record<string, unknown>;

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

// Public endpoint with no login — rate limit by IP. Fails open if the limiter itself is down so an
// outage there never stops a real customer from watching their videos.
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
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json({ error: "Video viewing is not configured." }, 500);
  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  const allowed = await checkRateLimit(supabaseUrl, serviceKey, `repair-videos:${clientIp(request)}`, 600, 60);
  if (!allowed) return json({ error: "Too many requests — please wait a few minutes and try again." }, 429);

  const token = new URL(request.url).searchParams.get("token");
  if (!token || token.length < 32) return json({ error: "This video link is invalid." }, 400);
  const tokenHash = await hashToken(token);
  const lookup = await fetch(`${supabaseUrl}/rest/v1/video_share_links?select=snapshot,expires_at&token_hash=eq.${tokenHash}&limit=1`, { headers: serviceHeaders });
  const row = lookup.ok ? (await lookup.json() as Array<{ snapshot: Snapshot; expires_at: string }>)[0] : undefined;
  if (!row) return json({ error: "This video link is invalid or expired." }, 404);
  if (new Date(row.expires_at).getTime() < Date.now()) return json({ error: "This video link has expired. Please contact the shop for a new one." }, 410);

  const snapshot = row.snapshot;
  const client = r2Client();
  const bucket = process.env.R2_VIDEOS_BUCKET;
  const videos = await Promise.all((snapshot.videos ?? []).map(async (video) => {
    const { storage_key: storageKey, ...rest } = video;
    let url: string | null = null;
    if (client && bucket && typeof storageKey === "string") {
      try { url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: storageKey }), { expiresIn: 14400 }); }
      catch { url = null; }
    }
    return { ...rest, url };
  }));
  return json({ snapshot: { ...snapshot, videos } });
};
