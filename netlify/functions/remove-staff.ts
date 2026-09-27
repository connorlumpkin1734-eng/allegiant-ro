const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !publicKey || !serviceKey) {
    return json({ error: "Staff management is not configured on this deployment." }, 500);
  }

  const authorization = request.headers.get("authorization") || "";
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json({ error: "Sign in again before removing staff." }, 401);
  const owner = await userResponse.json() as { id: string };

  const body = await request.json().catch(() => ({})) as { staffId?: string };
  if (!body.staffId) return json({ error: "Missing staff member." }, 400);

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  const staffLookup = await fetch(`${supabaseUrl}/rest/v1/staff?select=id,owner_id,auth_user_id&id=eq.${encodeURIComponent(body.staffId)}&limit=1`, { headers: serviceHeaders });
  const [staffRow] = staffLookup.ok ? await staffLookup.json() as Array<{ id: string; owner_id: string; auth_user_id: string | null }> : [];
  if (!staffRow || staffRow.owner_id !== owner.id) return json({ error: "Staff member not found." }, 404);

  const deleteStaff = await fetch(`${supabaseUrl}/rest/v1/staff?id=eq.${staffRow.id}`, { method: "DELETE", headers: serviceHeaders });
  if (!deleteStaff.ok) return json({ error: `Could not remove staff record: ${await deleteStaff.text()}` }, 400);

  if (staffRow.auth_user_id) {
    await fetch(`${supabaseUrl}/auth/v1/admin/users/${staffRow.auth_user_id}`, { method: "DELETE", headers: serviceHeaders });
  }

  return json({ message: "Staff member removed." });
};
