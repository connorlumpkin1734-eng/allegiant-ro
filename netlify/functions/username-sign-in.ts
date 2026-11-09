// Sign in with a username (staff or owner) without ever sending the email behind it to the browser.
// The password check happens here against Supabase Auth; the browser only gets the session back.
// Replaces resolve-username.ts, which handed the email to anyone who asked for a username.
//
// Two actions:
//   { action: "sign-in", username, password } → { access_token, refresh_token } or a generic error
//   { action: "reset", username, redirectTo }   → always the same generic answer
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const INVALID = "Invalid login credentials.";
const RESET_SENT = "If that account exists, a password reset link is on its way. Check your inbox.";
const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

async function emailForUsername(username: string, supabaseUrl: string, serviceKey: string): Promise<string | null> {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const staffResponse = await fetch(
    `${supabaseUrl}/rest/v1/staff?select=email,active&username_lower=eq.${encodeURIComponent(username)}&limit=1`,
    { headers }
  );
  const staffRows = staffResponse.ok ? await staffResponse.json() as Array<{ email: string; active: boolean }> : [];
  if (staffRows[0]) return staffRows[0].active ? staffRows[0].email : null;

  const ownerResponse = await fetch(
    `${supabaseUrl}/rest/v1/settings?select=owner_id&owner_username=eq.${encodeURIComponent(username)}&limit=1`,
    { headers }
  );
  const ownerRows = ownerResponse.ok ? await ownerResponse.json() as Array<{ owner_id: string }> : [];
  if (!ownerRows[0]) return null;
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users/${ownerRows[0].owner_id}`, { headers });
  if (!userResponse.ok) return null;
  const user = await userResponse.json() as { email?: string };
  return user.email || null;
}

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !serviceKey || !publicKey) return json({ error: "Not configured." }, 500);

  const body = await request.json().catch(() => ({})) as {
    action?: string; username?: string; password?: string; redirectTo?: string;
  };
  const username = (body.username || "").trim().toLowerCase();

  if (body.action === "reset") {
    if (!USERNAME_PATTERN.test(username)) return json({ message: RESET_SENT });
    const email = await emailForUsername(username, supabaseUrl, serviceKey).catch(() => null);
    if (email) {
      const redirect = body.redirectTo ? `?redirect_to=${encodeURIComponent(body.redirectTo)}` : "";
      await fetch(`${supabaseUrl}/auth/v1/recover${redirect}`, {
        method: "POST",
        headers: { apikey: publicKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      }).catch(() => undefined);
    }
    return json({ message: RESET_SENT });
  }

  if (body.action !== "sign-in") return json({ error: "Unknown action." }, 400);
  if (!USERNAME_PATTERN.test(username) || !body.password) return json({ error: INVALID }, 400);

  const email = await emailForUsername(username, supabaseUrl, serviceKey).catch(() => null);
  if (!email) return json({ error: INVALID }, 400);

  const tokenResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publicKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: body.password }),
  });
  if (tokenResponse.status === 429) return json({ error: "Too many sign-in attempts. Wait a minute and try again." }, 429);
  if (!tokenResponse.ok) return json({ error: INVALID }, 400);
  const session = await tokenResponse.json() as { access_token?: string; refresh_token?: string };
  if (!session.access_token || !session.refresh_token) return json({ error: INVALID }, 400);
  return json({ access_token: session.access_token, refresh_token: session.refresh_token });
};
