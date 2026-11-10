import { notifyError } from "../../lib/platform-alert";
import { recordSquarePayment } from "../../lib/square";
// Square calls this when a payment on a connected shop's account changes. A completed payment that
// matches one of our invoice checkouts marks the RO paid and records Square's fee.
//
// Set up in the Square Developer Console (Webhooks → subscription for payment.created and
// payment.updated) pointing at https://<site>/.netlify/functions/square-webhook. Its signature key
// goes in SQUARE_WEBHOOK_SIGNATURE_KEY. Square signs base64(HMAC-SHA256(key, notification URL + body)).
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

async function validSignature(key: string, url: string, body: string, signature: string) {
  const cryptoKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(url + body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return mismatch === 0;
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!supabaseUrl || !serviceKey || !signatureKey) return json({ error: "Square webhook is not configured." }, 500);

  const rawBody = await request.text();
  const signature = request.headers.get("x-square-hmacsha256-signature") || "";
  // Square signs the exact URL it was given. Behind Netlify the request URL can differ in host, so
  // check against the site's public URL as well.
  const path = new URL(request.url).pathname;
  const candidates = [request.url, `${process.env.URL || ""}${path}`].filter(Boolean);
  let ok = false;
  for (const url of candidates) {
    if (signature && await validSignature(signatureKey, url, rawBody, signature)) { ok = true; break; }
  }
  if (!ok) return json({ error: "Invalid signature." }, 400);

  const event = JSON.parse(rawBody) as { type?: string; data?: { object?: { payment?: Parameters<typeof recordSquarePayment>[1] } } };
  if ((event.type === "payment.updated" || event.type === "payment.created") && event.data?.object?.payment) {
    const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    await recordSquarePayment({ supabaseUrl, serviceHeaders }, event.data.object.payment);
  }
  return json({ received: true });
}

export default async (request: Request) => {
  try {
    return await handler(request);
  } catch (error) {
    await notifyError("square-webhook", error, request);
    return json({ error: "Something went wrong." }, 500);
  }
};
