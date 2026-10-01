// Staff-only. This is the ONLY place a Zelle payment is actually marked paid — a human has to
// click this after checking their own bank app, whether or not the customer clicked "I've sent
// payment" first. Mirrors what the Stripe webhook does automatically: flips payments.status to
// succeeded and repair_orders.paid to true.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

// Best-effort alert email to Connor when this function throws an uncaught exception — otherwise a
// bug or an upstream outage (Stripe/Supabase/Resend down) fails silently with nobody finding out
// until a shop or customer complains. Never lets the alert itself break the real response.
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

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !publicKey || !serviceKey) return json({ error: "Payments configuration could not be loaded." }, 500);

  const authorization = request.headers.get("authorization") || "";
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json({ error: "Sign in again before confirming payment." }, 401);
  const caller = await userResponse.json() as { id: string };
  const body = await request.json().catch(() => ({})) as { paymentId?: string; note?: string };
  if (!body.paymentId) return json({ error: "Missing payment." }, 400);

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
      return json({ error: "Only the shop owner or a service advisor can confirm payment." }, 403);
    }
    ownerId = staff.owner_id;
  }

  const paymentResponse = await fetch(
    `${supabaseUrl}/rest/v1/payments?select=id,owner_id,repair_order_id,processor,status&id=eq.${encodeURIComponent(body.paymentId)}&owner_id=eq.${ownerId}&limit=1`,
    { headers: serviceHeaders }
  );
  const paymentRows = paymentResponse.ok ? await paymentResponse.json() as Array<{ id: string; owner_id: string; repair_order_id: string; processor: string; status: string }> : [];
  const payment = paymentRows[0];
  if (!payment) return json({ error: "Payment not found." }, 404);
  if (payment.processor !== "zelle") return json({ error: "Only Zelle payments are confirmed this way." }, 400);
  if (payment.status === "succeeded") return json({ message: "Already confirmed." });

  const updatePayment = await fetch(`${supabaseUrl}/rest/v1/payments?id=eq.${payment.id}`, {
    method: "PATCH",
    headers: serviceHeaders,
    body: JSON.stringify({
      status: "succeeded",
      confirmed_by: caller.id,
      confirmation_note: (body.note || "").trim() || null,
    }),
  });
  if (!updatePayment.ok) return json({ error: `Could not confirm payment: ${await updatePayment.text()}` }, 500);

  const updateRo = await fetch(`${supabaseUrl}/rest/v1/repair_orders?id=eq.${payment.repair_order_id}`, {
    method: "PATCH",
    headers: serviceHeaders,
    body: JSON.stringify({ paid: true, paid_at: new Date().toISOString() }),
  });
  if (!updateRo.ok) return json({ error: `Payment confirmed, but could not mark the invoice paid: ${await updateRo.text()}` }, 500);

  return json({ message: "Payment confirmed — invoice marked paid." });
}

export default async (request: Request) => {
  try {
    return await handler(request);
  } catch (error) {
    await notifyError("confirm-zelle-payment", error, request);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};
