// Issues a presigned PUT URL so the browser can upload a video clip directly to Cloudflare R2 —
// never through this function's own body, which would hit Netlify's function payload size limit
// long before a real video file does. The actual estimate_videos row is inserted by the client
// afterward via the normal Supabase client (RLS-governed, same pattern as estimate_photos), once
// the upload to R2 has actually succeeded.
//
// R2 is used instead of Supabase Storage specifically because video gets viewed repeatedly by both
// staff and customers, and Supabase bills per-GB egress on every view — R2's egress is free. See
// supabase/migrations/20261004_estimate_videos.sql.
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
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

const ALLOWED_CONTENT_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

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
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.R2_VIDEOS_BUCKET;
  if (!supabaseUrl || !publicKey || !serviceKey || !bucket) return json({ error: "Video upload is not configured." }, 500);
  const client = r2Client();
  if (!client) return json({ error: "Video storage is not configured." }, 500);

  const authorization = request.headers.get("authorization") || "";
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json({ error: "Sign in again before uploading video." }, 401);
  const caller = await userResponse.json() as { id: string };
  const body = await request.json().catch(() => ({})) as { repairOrderId?: string; contentType?: string };
  if (!body.repairOrderId) return json({ error: "Missing repair order." }, 400);
  const contentType = body.contentType && ALLOWED_CONTENT_TYPES.includes(body.contentType) ? body.contentType : "video/mp4";

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  // Resolve the caller to a shop and confirm they can actually touch this specific repair order —
  // owner or service_advisor can touch any RO in their shop; a technician only one they're assigned
  // to. Mirrors the access rules in migration 20261004_estimate_videos.sql's RLS policies, since the
  // real enforcement happens there when the row gets inserted — this check just avoids handing out
  // a presigned upload URL to someone who's about to get rejected by RLS anyway.
  let ownerId = caller.id;
  const settingsSelfResponse = await fetch(`${supabaseUrl}/rest/v1/settings?select=owner_id&owner_id=eq.${caller.id}&limit=1`, { headers: serviceHeaders });
  const isOwner = settingsSelfResponse.ok && (await settingsSelfResponse.json() as unknown[]).length > 0;
  if (!isOwner) {
    const staffResponse = await fetch(
      `${supabaseUrl}/rest/v1/staff?select=id,owner_id,role,is_admin&auth_user_id=eq.${caller.id}&active=eq.true&limit=1`,
      { headers: serviceHeaders }
    );
    const staffRows = staffResponse.ok ? await staffResponse.json() as Array<{ id: string; owner_id: string; role: string; is_admin: boolean }> : [];
    const staff = staffRows[0];
    if (!staff) return json({ error: "Sign in again before uploading video." }, 403);
    ownerId = staff.owner_id;
    if (staff.role === "technician" && !staff.is_admin) {
      const assignedResponse = await fetch(
        `${supabaseUrl}/rest/v1/repair_order_technicians?select=id&repair_order_id=eq.${encodeURIComponent(body.repairOrderId)}&staff_id=eq.${staff.id}&limit=1`,
        { headers: serviceHeaders }
      );
      const assignedRows = assignedResponse.ok ? await assignedResponse.json() as unknown[] : [];
      if (!assignedRows.length) return json({ error: "You're not assigned to this repair order." }, 403);
    }
  }

  const roResponse = await fetch(`${supabaseUrl}/rest/v1/repair_orders?select=id&id=eq.${encodeURIComponent(body.repairOrderId)}&owner_id=eq.${ownerId}&limit=1`, { headers: serviceHeaders });
  const roRows = roResponse.ok ? await roResponse.json() as unknown[] : [];
  if (!roRows.length) return json({ error: "Repair order not found." }, 404);

  const extension = contentType === "video/webm" ? "webm" : contentType === "video/quicktime" ? "mov" : "mp4";
  const key = `${ownerId}/${body.repairOrderId}/${crypto.randomUUID()}.${extension}`;
  const uploadUrl = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn: 600 });

  return json({ uploadUrl, key, contentType });
}

export default async (request: Request) => {
  try {
    return await handler(request);
  } catch (error) {
    await notifyError("create-video-upload-url", error, request);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};
