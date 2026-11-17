import { notifyError } from "../../lib/platform-alert";
// Owner-only: change a staff member's email (used for their password resets). Updates the
// staff row and the login behind it together so username sign-in keeps working.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !publicKey || !serviceKey) return json({ error: "Not configured on this deployment." }, 500);

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: request.headers.get("authorization") || "" },
  });
  if (!userResponse.ok) return json({ error: "Sign in again first." }, 401);
  const caller = await userResponse.json() as { id: string };

  const body = await request.json().catch(() => ({})) as { staffId?: string; email?: string };
  const email = (body.email || "").trim().toLowerCase();
  if (!body.staffId) return json({ error: "Missing staff member." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const ownerCheck = await fetch(`${supabaseUrl}/rest/v1/settings?select=owner_id&owner_id=eq.${caller.id}&limit=1`, { headers: serviceHeaders });
  const ownerRows = ownerCheck.ok ? await ownerCheck.json() as Array<{ owner_id: string }> : [];
  if (!ownerRows.length) return json({ error: "Only the shop owner can change staff emails." }, 403);

  const staffResponse = await fetch(
    `${supabaseUrl}/rest/v1/staff?select=id,auth_user_id,email&id=eq.${encodeURIComponent(body.staffId)}&owner_id=eq.${caller.id}&limit=1`,
    { headers: serviceHeaders },
  );
  const member = (staffResponse.ok ? await staffResponse.json() as Array<{ id: string; auth_user_id: string | null; email: string }> : [])[0];
  if (!member) return json({ error: "That staff member isn't in your shop." }, 404);
  if (member.email?.toLowerCase() === email) return json({ message: "No change." });

  if (member.auth_user_id) {
    const authUpdate = await fetch(`${supabaseUrl}/auth/v1/admin/users/${member.auth_user_id}`, {
      method: "PUT", headers: serviceHeaders, body: JSON.stringify({ email, email_confirm: true }),
    });
    if (!authUpdate.ok) {
      const detail = await authUpdate.json().catch(() => ({})) as { msg?: string; error_description?: string; error_code?: string };
      const taken = /already|registered|exists/i.test(`${detail.msg} ${detail.error_description} ${detail.error_code}`);
      return json({ error: taken ? "That email already has an account." : "Couldn't update their login. Try again." }, 400);
    }
  }
  const staffUpdate = await fetch(`${supabaseUrl}/rest/v1/staff?id=eq.${member.id}`, {
    method: "PATCH", headers: serviceHeaders, body: JSON.stringify({ email }),
  });
  if (!staffUpdate.ok) return json({ error: "Their login changed, but the staff list didn't. Refresh and try again." }, 500);
  return json({ message: `Email changed to ${email}.` });
}

export default async (request: Request) => {
  try {
    return await handler(request);
  } catch (error) {
    await notifyError("update-staff-email", error, request);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};
