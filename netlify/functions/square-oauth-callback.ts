import { notifyError } from "../../lib/platform-alert";
import { squareApi, squareConfig, squareTokenRequest } from "../../lib/square";
// Square sends the shop owner here after they approve (or decline) ROrunner on Square's site.
// Exchanges the one-time code for the shop's tokens, picks the shop's card-processing location,
// saves it, and sends the owner back to Settings.

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function backToSettings(siteUrl: string, result: string) {
  return new Response(null, { status: 302, headers: { Location: new URL(`/?square=${result}#settings`, siteUrl).toString(), "Cache-Control": "no-store" } });
}

type Location = { id: string; name?: string; status?: string; capabilities?: string[]; currency?: string };

async function handler(request: Request): Promise<Response> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const siteUrl = process.env.URL || new URL(request.url).origin;
  if (!supabaseUrl || !serviceKey || !squareConfig().configured) return backToSettings(siteUrl, "error");
  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  const params = new URL(request.url).searchParams;
  const state = params.get("state");
  const code = params.get("code");
  if (!state) return backToSettings(siteUrl, "error");

  // The state proves which owner started this, and can be used once.
  const stateHash = await hashToken(state);
  const stateResponse = await fetch(`${supabaseUrl}/rest/v1/square_oauth_states?select=owner_id,created_at&state_hash=eq.${stateHash}&limit=1`, { headers: serviceHeaders });
  const stateRow = (stateResponse.ok ? await stateResponse.json() as Array<{ owner_id: string; created_at: string }> : [])[0];
  await fetch(`${supabaseUrl}/rest/v1/square_oauth_states?state_hash=eq.${stateHash}`, { method: "DELETE", headers: serviceHeaders });
  if (!stateRow || Date.now() - new Date(stateRow.created_at).getTime() > 15 * 60 * 1000) return backToSettings(siteUrl, "expired");
  if (!code) return backToSettings(siteUrl, "declined");
  const ownerId = stateRow.owner_id;

  const token = await squareTokenRequest({ grant_type: "authorization_code", code });
  if (!token.ok || !token.access_token || !token.merchant_id) return backToSettings(siteUrl, "error");

  const locations = await squareApi<{ locations?: Location[] }>(token.access_token, "/v2/locations");
  const usable = (locations.data.locations || []).filter((location) =>
    location.status === "ACTIVE" && (location.capabilities || []).includes("CREDIT_CARD_PROCESSING") && (!location.currency || location.currency === "USD")
  );
  const location = usable[0];
  if (!location) return backToSettings(siteUrl, "no-location");

  const saved = await fetch(`${supabaseUrl}/rest/v1/square_connections?on_conflict=owner_id`, {
    method: "POST",
    headers: { ...serviceHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      owner_id: ownerId,
      merchant_id: token.merchant_id,
      access_token: token.access_token,
      refresh_token: token.refresh_token || null,
      expires_at: token.expires_at || null,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!saved.ok) return backToSettings(siteUrl, "error");

  await fetch(`${supabaseUrl}/rest/v1/settings?owner_id=eq.${ownerId}`, {
    method: "PATCH",
    headers: serviceHeaders,
    body: JSON.stringify({
      square_merchant_id: token.merchant_id,
      square_location_id: location.id,
      square_location_name: location.name || null,
      card_processor: "square",
    }),
  });
  return backToSettings(siteUrl, "connected");
}

export default async (request: Request) => {
  try {
    return await handler(request);
  } catch (error) {
    await notifyError("square-oauth-callback", error, request);
    const siteUrl = process.env.URL || new URL(request.url).origin;
    return backToSettings(siteUrl, "error");
  }
};
