import { notifyError } from "../../lib/platform-alert";
import { checkSquareOrder } from "../../lib/square";
// Public. Called by the payment-status page when a customer lands back from Square checkout, with
// the id of our pending payments row. Asks Square whether that order was paid and, if so, marks the
// invoice paid right away (the webhook does the same; whichever comes first wins). Only ever
// records what Square itself reports, so it's safe to expose.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json({ error: "Not configured." }, 500);
  const body = await request.json().catch(() => ({})) as { payment?: string };
  if (!body.payment || !UUID.test(body.payment)) return json({ error: "Invalid payment." }, 400);

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const rowResponse = await fetch(`${supabaseUrl}/rest/v1/payments?select=owner_id,processor_session_id,status&processor=eq.square&id=eq.${body.payment}&limit=1`, { headers: serviceHeaders });
  const row = (rowResponse.ok ? await rowResponse.json() as Array<{ owner_id: string; processor_session_id: string | null; status: string }> : [])[0];
  if (!row || !row.processor_session_id) return json({ paid: false });
  if (row.status === "succeeded") return json({ paid: true });

  const result = await checkSquareOrder({ supabaseUrl, serviceHeaders }, row.owner_id, row.processor_session_id);
  return json({ paid: result === "paid" });
}

export default async (request: Request) => {
  try {
    return await handler(request);
  } catch (error) {
    await notifyError("square-payment-check", error, request);
    return json({ error: "Something went wrong." }, 500);
  }
};
