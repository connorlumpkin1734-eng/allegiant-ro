import { notifyError } from "../../lib/platform-alert";
import { SQUARE_SCOPES, squareApi, squareConfig } from "../../lib/square";
// Owner-only. Links or unlinks the shop's own Square account.
//   POST { action: "connect" }    -> { url } of Square's authorize page (finished in square-oauth-callback.ts)
//   POST { action: "disconnect" } -> revokes ROrunner's access and clears the connection
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const config = squareConfig();
  if (!supabaseUrl || !publicKey || !serviceKey) return json({ error: "Payments configuration could not be loaded." }, 500);
  if (!config.configured) return json({ error: "Square isn't set up on this site yet." }, 500);

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: request.headers.get("authorization") || "" },
  });
  if (!userResponse.ok) return json({ error: "Sign in again." }, 401);
  const user = await userResponse.json() as { id: string };

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const settingsResponse = await fetch(`${supabaseUrl}/rest/v1/settings?select=owner_id,card_processor,stripe_account_id,stripe_charges_enabled&owner_id=eq.${user.id}&limit=1`, { headers: serviceHeaders });
  const settings = (settingsResponse.ok ? await settingsResponse.json() as Array<{ owner_id: string; card_processor: string | null; stripe_account_id: string | null; stripe_charges_enabled: boolean }> : [])[0];
  if (!settings) return json({ error: "Only the shop owner can connect Square." }, 403);

  const body = await request.json().catch(() => ({})) as { action?: string };

  if (body.action === "connect") {
    const state = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
    // Clear this owner's older unfinished attempts, then record this one.
    await fetch(`${supabaseUrl}/rest/v1/square_oauth_states?owner_id=eq.${user.id}`, { method: "DELETE", headers: serviceHeaders });
    const insert = await fetch(`${supabaseUrl}/rest/v1/square_oauth_states`, {
      method: "POST", headers: serviceHeaders, body: JSON.stringify({ state_hash: await hashToken(state), owner_id: user.id }),
    });
    if (!insert.ok) return json({ error: "Could not start the Square connection. Try again." }, 500);
    const url = new URL(`${config.base}/oauth2/authorize`);
    url.searchParams.set("client_id", config.applicationId);
    url.searchParams.set("scope", SQUARE_SCOPES.join(" "));
    url.searchParams.set("session", "false");
    url.searchParams.set("state", state);
    return json({ url: url.toString() });
  }

  if (body.action === "disconnect") {
    const connectionResponse = await fetch(`${supabaseUrl}/rest/v1/square_connections?select=access_token&owner_id=eq.${user.id}&limit=1`, { headers: serviceHeaders });
    const connection = (connectionResponse.ok ? await connectionResponse.json() as Array<{ access_token: string }> : [])[0];
    if (connection) {
      // Best-effort: tell Square to revoke ROrunner's access. Our side is cleared either way.
      try {
        await fetch(`${config.base}/oauth2/revoke`, {
          method: "POST",
          headers: { Authorization: `Client ${config.applicationSecret}`, "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: config.applicationId, access_token: connection.access_token }),
        });
      } catch {
        // Ignore.
      }
    }
    await fetch(`${supabaseUrl}/rest/v1/square_connections?owner_id=eq.${user.id}`, { method: "DELETE", headers: serviceHeaders });
    const stripeReady = Boolean(settings.stripe_account_id && settings.stripe_charges_enabled);
    await fetch(`${supabaseUrl}/rest/v1/settings?owner_id=eq.${user.id}`, {
      method: "PATCH", headers: serviceHeaders,
      body: JSON.stringify({
        square_merchant_id: null, square_location_id: null, square_location_name: null,
        card_processor: settings.card_processor === "square" ? (stripeReady ? "stripe" : null) : settings.card_processor,
      }),
    });
    return json({ disconnected: true });
  }

  if (body.action === "status") {
    // Confirms the saved Square connection still works (the shop can revoke it from Square).
    const connectionResponse = await fetch(`${supabaseUrl}/rest/v1/square_connections?select=access_token&owner_id=eq.${user.id}&limit=1`, { headers: serviceHeaders });
    const connection = (connectionResponse.ok ? await connectionResponse.json() as Array<{ access_token: string }> : [])[0];
    if (!connection) return json({ connected: false });
    const check = await squareApi<unknown>(connection.access_token, "/v2/locations");
    return json({ connected: check.ok });
  }

  return json({ error: "Unknown action." }, 400);
}

export default async (request: Request) => {
  try {
    return await handler(request);
  } catch (error) {
    await notifyError("square-connect", error, request);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};
