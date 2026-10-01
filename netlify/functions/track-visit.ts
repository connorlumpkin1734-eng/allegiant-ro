// Public, unauthenticated endpoint called once per landing-page load (see AuthScreen) to log a
// visit for the god-mode traffic counter. visitorId is a random id the browser generates itself and
// stores in localStorage — never a name, email, or anything tied to an account. Never blocks or
// fails loudly: a tracking hiccup should never affect anyone's ability to use the app.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

export default async (request: Request) => {
  if (request.method !== "POST") return json({ ok: false }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json({ ok: false });

  const body = await request.json().catch(() => ({})) as { visitorId?: string };
  const visitorId = (body.visitorId || "").trim().slice(0, 100);
  if (!visitorId) return json({ ok: false });

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  try {
    await fetch(`${supabaseUrl}/rest/v1/site_visits`, {
      method: "POST",
      headers: serviceHeaders,
      body: JSON.stringify({ visitor_id: visitorId }),
    });
  } catch {
    // Best-effort only.
  }

  return json({ ok: true });
};
