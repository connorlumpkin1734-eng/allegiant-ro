const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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
  const body = request.method === "POST"
    ? await request.json().catch(() => ({})) as { token?: string; action?: string; signerName?: string; signatureData?: string; consent?: boolean }
    : {};
  const token = request.method === "GET" ? url.searchParams.get("token") : body.token;
  if (!token || token.length < 32) return json({ error: "This approval link is invalid." }, 400);
  const tokenHash = await hashToken(token);
  const lookup = await fetch(`${supabaseUrl}/rest/v1/estimate_authorizations?select=id,repair_order_id,status,customer_name,estimate_snapshot,responded_at&token_hash=eq.${tokenHash}&limit=1`, { headers: serviceHeaders });
  const authorization = (await lookup.json() as Array<Record<string, unknown>>)[0];
  if (!authorization) return json({ error: "This approval link is invalid or expired." }, 404);
  if (request.method === "GET") return json({ authorization });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  if (!['approved', 'declined'].includes(body.action || "")) return json({ error: "Choose approve or decline." }, 400);
  if (authorization.status !== "sent") return json({ error: `This estimate was already ${authorization.status}.` }, 409);
  if (body.action === "approved" && (!body.signerName?.trim() || !body.signatureData || !body.consent)) {
    return json({ error: "Enter your name, sign, and accept the authorization statement." }, 400);
  }

  const now = new Date().toISOString();
  const update = await fetch(`${supabaseUrl}/rest/v1/estimate_authorizations?id=eq.${authorization.id}&status=eq.sent`, {
    method: "PATCH",
    headers: { ...serviceHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      status: body.action,
      customer_name: body.signerName?.trim() || null,
      signature_data: body.action === "approved" ? body.signatureData : null,
      consent_accepted: body.action === "approved" ? Boolean(body.consent) : false,
      response_ip: request.headers.get("x-nf-client-connection-ip") || request.headers.get("x-forwarded-for") || null,
      response_user_agent: request.headers.get("user-agent"),
      responded_at: now,
    }),
  });
  const updated = await update.json() as unknown[];
  if (!update.ok || !updated.length) return json({ error: "This estimate has already been answered." }, 409);
  await fetch(`${supabaseUrl}/rest/v1/repair_orders?id=eq.${authorization.repair_order_id}`, {
    method: "PATCH", headers: serviceHeaders, body: JSON.stringify({ estimate_status: body.action, estimate_responded_at: now }),
  });
  return json({ status: body.action });
};
