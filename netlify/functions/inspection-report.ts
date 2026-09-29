// Public, read-only lookup for a shared multipoint inspection report. Mirrors estimate-approval.ts's
// GET path: a customer's link carries a random token, we hash it and look up the matching row.
// No decisions/signatures here — this is informational only, unlike the estimate approval flow.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default async (request: Request) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json({ error: "Inspection reports are not configured." }, 500);
  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  const url = new URL(request.url);
  const token = request.method === "GET"
    ? url.searchParams.get("token")
    : ((await request.json().catch(() => ({})) as { token?: string }).token);
  if (!token || token.length < 32) return json({ error: "This inspection link is invalid." }, 400);
  const tokenHash = await hashToken(token);

  const lookup = await fetch(
    `${supabaseUrl}/rest/v1/multipoint_inspections?select=data,shared_at,owner_id,repair_orders(ro_number,mileage_in,customers(name),vehicles(year,make,model,trim,vin))&share_token_hash=eq.${tokenHash}&limit=1`,
    { headers: serviceHeaders }
  );
  const rows = await lookup.json() as Array<Record<string, unknown>>;
  const inspection = rows[0];
  if (!inspection) return json({ error: "This inspection link is invalid or has been removed." }, 404);

  const settingsResponse = await fetch(`${supabaseUrl}/rest/v1/settings?select=business_name,business_address,business_phone,business_email,logo_path,primary_color,accent_color&owner_id=eq.${inspection.owner_id}&limit=1`, { headers: serviceHeaders });
  const settings = (settingsResponse.ok ? await settingsResponse.json() as Array<Record<string, unknown>> : [])[0] || {};
  const logoPath = settings.logo_path as string | null | undefined;
  const logoUrl = logoPath ? `${supabaseUrl}/storage/v1/object/public/shop-branding/${logoPath}` : null;

  return json({
    inspection: {
      data: inspection.data,
      sharedAt: inspection.shared_at,
      repairOrder: inspection.repair_orders,
    },
    business: {
      name: settings.business_name || "Allegiant Auto Care",
      address: settings.business_address || "",
      phone: settings.business_phone || "",
      email: settings.business_email || "",
      logoUrl,
      primaryColor: settings.primary_color || "#2459a9",
      accentColor: settings.accent_color || "#b5222d",
    },
  });
};
