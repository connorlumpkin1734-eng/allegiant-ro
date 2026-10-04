// Returns a short-lived presigned URL to play back one video clip stored in R2. Authorization is
// delegated to Postgres RLS rather than reimplemented here: the lookup runs as the CALLER'S OWN
// Supabase session (their JWT, not the service-role key), so the same "Staff can view scoped
// estimate videos" policy that governs a direct table read also governs this — if the row doesn't
// come back, either it doesn't exist or they're not allowed to see it, and either way the answer is
// the same 404 (never reveal which, same reasoning as a missing-vs-unauthorized photo).
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
    // If Resend itself is down there's nothing more we can do here.
  }
}

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

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const bucket = process.env.R2_VIDEOS_BUCKET;
  if (!supabaseUrl || !publicKey || !bucket) return json({ error: "Video playback is not configured." }, 500);
  const client = r2Client();
  if (!client) return json({ error: "Video storage is not configured." }, 500);

  const authorization = request.headers.get("authorization") || "";
  const body = await request.json().catch(() => ({})) as { videoId?: string };
  if (!body.videoId) return json({ error: "Missing video." }, 400);

  const videoResponse = await fetch(
    `${supabaseUrl}/rest/v1/estimate_videos?select=storage_key&id=eq.${encodeURIComponent(body.videoId)}&limit=1`,
    { headers: { apikey: publicKey, Authorization: authorization } } // caller's own session — RLS decides what they can see
  );
  if (!videoResponse.ok) return json({ error: "Sign in again before viewing video." }, 401);
  const rows = await videoResponse.json() as Array<{ storage_key: string }>;
  const video = rows[0];
  if (!video) return json({ error: "Video not found." }, 404);

  const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: video.storage_key }), { expiresIn: 3600 });
  return json({ url });
}

export default async (request: Request) => {
  try {
    return await handler(request);
  } catch (error) {
    await notifyError("get-video-url", error, request);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};
