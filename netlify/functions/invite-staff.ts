const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

function generateTempPassword() {
  // Avoids visually ambiguous characters (0/O, 1/l/I) so it's easy to read off a screen and type.
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  for (let i = 0; i < bytes.length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !publicKey || !serviceKey) {
    return json({ error: "Staff invites are not configured on this deployment." }, 500);
  }

  const authorization = request.headers.get("authorization") || "";
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json({ error: "Sign in again before adding staff." }, 401);
  const owner = await userResponse.json() as { id: string };

  const body = await request.json().catch(() => ({})) as {
    name?: string; email?: string; role?: string; teamId?: string | null; canViewAllWork?: boolean;
  };
  const name = (body.name || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const role = body.role;
  if (!name) return json({ error: "Enter a name." }, 400);
  if (!email || !email.includes("@")) return json({ error: "Enter a valid email address." }, 400);
  if (role !== "technician" && role !== "service_advisor") return json({ error: "Choose a role." }, 400);

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  // Owner-only: confirm the caller actually owns a settings row (i.e. isn't a staff account itself).
  const settingsCheck = await fetch(`${supabaseUrl}/rest/v1/settings?select=owner_id&owner_id=eq.${owner.id}&limit=1`, { headers: serviceHeaders });
  const settingsRows = settingsCheck.ok ? await settingsCheck.json() as Array<Record<string, unknown>> : [];
  if (!settingsRows.length) return json({ error: "Only the shop owner can add staff." }, 403);

  const tempPassword = generateTempPassword();
  const createUserResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders,
    body: JSON.stringify({ email, password: tempPassword, email_confirm: true }),
  });
  const createdUser = await createUserResponse.json().catch(() => ({})) as { id?: string; msg?: string; error_description?: string; code?: string };
  if (!createUserResponse.ok || !createdUser.id) {
    const alreadyExists = createUserResponse.status === 422 || /already been registered|already exists/i.test(createdUser.msg || createdUser.error_description || "");
    return json({ error: alreadyExists ? "That email already has an account." : (createdUser.msg || createdUser.error_description || "Could not create the staff login.") }, 400);
  }

  const staffInsert = await fetch(`${supabaseUrl}/rest/v1/staff`, {
    method: "POST",
    headers: { ...serviceHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      owner_id: owner.id,
      auth_user_id: createdUser.id,
      name,
      email,
      role,
      team_id: body.teamId || null,
      can_view_all_work: Boolean(body.canViewAllWork),
      active: true,
    }),
  });
  if (!staffInsert.ok) {
    // Roll back the auth user so we don't leave an orphaned login with no staff record.
    await fetch(`${supabaseUrl}/auth/v1/admin/users/${createdUser.id}`, { method: "DELETE", headers: serviceHeaders });
    const errorText = await staffInsert.text();
    const duplicate = /duplicate key|unique constraint/i.test(errorText);
    return json({ error: duplicate ? "That email is already on your staff list." : `Could not save the staff record: ${errorText}` }, 400);
  }
  const [staffRow] = await staffInsert.json() as Array<Record<string, unknown>>;

  return json({ message: "Staff account created.", tempPassword, staff: staffRow });
};
