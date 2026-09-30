// Lightweight "is this username available" check used by the Add Staff form as someone types, so
// they find out before submitting the whole form. Unlike resolve-username.ts (which returns the
// real email behind a username, for login), this only ever returns a yes/no — it never reveals
// anything about who a taken username belongs to.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json({ error: "Not configured." }, 500);

  const body = await request.json().catch(() => ({})) as { username?: string };
  const username = (body.username || "").trim();
  if (!USERNAME_PATTERN.test(username)) return json({ available: false, reason: "invalid" });

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const response = await fetch(
    `${supabaseUrl}/rest/v1/staff?select=id&username_lower=eq.${encodeURIComponent(username.toLowerCase())}&limit=1`,
    { headers: serviceHeaders }
  );
  const rows = response.ok ? await response.json() as Array<{ id: string }> : [];
  return json({ available: rows.length === 0 });
};
