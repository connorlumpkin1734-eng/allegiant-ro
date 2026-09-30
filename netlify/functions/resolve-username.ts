// Public, unauthenticated endpoint used only by the login/forgot-password screen: turns a staff
// username into the real email address behind it, so the browser can then call Supabase Auth with
// that email the normal way. Staff never need to know or type their real email day-to-day.
//
// This deliberately reveals nothing about *whether* a username exists beyond a generic 404 — the
// caller should show the same "invalid login" / "if that account exists…" message either way.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json({ error: "Not configured." }, 500);

  const body = await request.json().catch(() => ({})) as { username?: string };
  const username = (body.username || "").trim().toLowerCase();
  if (!username) return json({ error: "Not found." }, 404);

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const response = await fetch(
    `${supabaseUrl}/rest/v1/staff?select=email,active&username_lower=eq.${encodeURIComponent(username)}&limit=1`,
    { headers: serviceHeaders }
  );
  const rows = response.ok ? await response.json() as Array<{ email: string; active: boolean }> : [];
  const match = rows[0];
  if (!match || !match.active) return json({ error: "Not found." }, 404);

  return json({ email: match.email });
};
