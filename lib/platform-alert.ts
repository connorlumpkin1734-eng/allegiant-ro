import { getStore } from "@netlify/blobs";
import { alertsFrom } from "./email-from";

// Errors in ROrunner itself (a function crashed, the nightly backup failed) go to whoever runs the
// platform — never to a shop. Who that is comes from the PLATFORM_ALERT_EMAIL setting on the Netlify
// site (comma-separate several addresses). With no address set, the error is only logged.
//
// The same error is emailed at most once every 30 minutes, so one bug hitting many shops at once
// doesn't bury the inbox; every occurrence is still in the Netlify function logs.
const QUIET_MS = 30 * 60 * 1000;

function recipients(): string[] {
  return (process.env.PLATFORM_ALERT_EMAIL || "")
    .split(",")
    .map((address) => address.trim())
    .filter((address) => address.includes("@"));
}

async function fingerprint(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function recentlySent(key: string): Promise<boolean> {
  try {
    const store = getStore("platform-alerts");
    const last = await store.get(key);
    if (last && Date.now() - Number(last) < QUIET_MS) return true;
    await store.set(key, String(Date.now()));
  } catch {
    // If the store isn't reachable, send rather than risk missing an alert.
  }
  return false;
}

export async function notifyError(functionName: string, error: unknown, request: Request) {
  const detail = error instanceof Error ? `${error.message}\n\n${error.stack || ""}` : String(error);
  console.error(`[${functionName}]`, detail);
  try {
    const to = recipients();
    const resendKey = process.env.RESEND_API_KEY;
    if (!to.length || !resendKey) return;
    const headline = (error instanceof Error ? error.message : String(error)).slice(0, 200);
    if (await recentlySent(await fingerprint(`${functionName}|${headline}`))) return;
    const site = process.env.URL || new URL(request.url).origin;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: alertsFrom(),
        to,
        subject: `[ROrunner] ${functionName} failed`,
        text: `${functionName} on ${site} (${request.method} ${new URL(request.url).pathname}) threw an error:\n\n${detail}\n\nThe same error won't be emailed again for 30 minutes; every occurrence is in the Netlify function logs.`,
      }),
    });
  } catch {
    // Nothing more to do if the alert itself fails.
  }
}
