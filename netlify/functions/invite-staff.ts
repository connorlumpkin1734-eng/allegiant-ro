const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

// Best-effort alert email to Connor when this function throws an uncaught exception — otherwise a
// bug or an upstream outage (Stripe/Supabase/Resend down) fails silently with nobody finding out
// until a shop or customer complains. Never lets the alert itself break the real response.
async function notifyError(functionName: string, error: unknown, request: Request) {
  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return;
    const detail = error instanceof Error ? `${error.message}\n\n${error.stack || ""}` : String(error);
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Allegiant RO Alerts <alerts@allegiantautocare.com>",
        to: ["connor.lumpkin1734@gmail.com"],
        subject: `[Allegiant RO] ${functionName} threw an error`,
        text: `${functionName} (${request.method} ${request.url}) threw an uncaught error:\n\n${detail}`,
      }),
    });
  } catch {
    // If Resend itself is down there's nothing more we can do here.
  }
}


const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

// Short, easy-to-read-off-a-screen-or-sticky-note temp password: two plain words plus a couple of
// digits (e.g. "Falcon-Otter47"). It only has to be typed once — the app forces a real password to
// be set before the account can do anything else — so it trades raw entropy for something an owner
// can actually hand to ten techs without it being a chore.
const TEMP_PASSWORD_WORDS = [
  "Falcon", "Otter", "Maple", "Ranger", "Comet", "Harbor", "Cobalt", "Ember", "Willow", "Granite",
  "Badger", "Cedar", "Quartz", "Raven", "Summit", "Delta", "Juniper", "Marlin", "Ridge", "Sable",
  "Tundra", "Pine", "Copper", "Falcon2", "Boulder", "Canyon", "Drift", "Echo", "Fable", "Glacier",
  "Hazel", "Ironwood", "Jasper", "Kestrel", "Lumen", "Mesa", "Nimbus", "Onyx", "Piston", "Quartzite",
];

function generateTempPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const word1 = TEMP_PASSWORD_WORDS[bytes[0] % TEMP_PASSWORD_WORDS.length];
  let word2 = TEMP_PASSWORD_WORDS[bytes[1] % TEMP_PASSWORD_WORDS.length];
  if (word2 === word1) word2 = TEMP_PASSWORD_WORDS[(bytes[1] + 1) % TEMP_PASSWORD_WORDS.length];
  const digits = String(10 + (bytes[2] ^ bytes[3]) % 90); // 2-digit number, 10-99
  return `${word1}-${word2}${digits}`;
}

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

async function handler(request: Request): Promise<Response> {
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
    name?: string; email?: string; username?: string; employeeId?: string | null; role?: string; teamId?: string | null; canViewAllWork?: boolean; isAdmin?: boolean;
  };
  const name = (body.name || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const username = (body.username || "").trim();
  const role = body.role;
  if (!name) return json({ error: "Enter a name." }, 400);
  if (!email || !email.includes("@")) return json({ error: "Enter a valid email address (used only for password resets)." }, 400);
  if (!USERNAME_PATTERN.test(username)) {
    return json({ error: "Username must be 3-20 characters, letters/numbers/underscore only." }, 400);
  }
  if (role !== "technician" && role !== "service_advisor") return json({ error: "Choose a role." }, 400);

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  // Owner-only: confirm the caller actually owns a settings row (i.e. isn't a staff account itself).
  const settingsCheck = await fetch(
    `${supabaseUrl}/rest/v1/settings?select=owner_id,business_name,business_email&owner_id=eq.${owner.id}&limit=1`,
    { headers: serviceHeaders }
  );
  const settingsRows = settingsCheck.ok ? await settingsCheck.json() as Array<{ owner_id: string; business_name?: string; business_email?: string }> : [];
  if (!settingsRows.length) return json({ error: "Only the shop owner can add staff." }, 403);
  const shopSettings = settingsRows[0];
  const businessName = shopSettings.business_name || "Allegiant Auto Care";

  // Usernames are unique across the whole platform (the login screen resolves a username to an
  // email before it knows which shop someone belongs to), so check for a collision up front.
  const usernameLower = username.toLowerCase();
  const usernameCheck = await fetch(
    `${supabaseUrl}/rest/v1/staff?select=id&username_lower=eq.${encodeURIComponent(usernameLower)}&limit=1`,
    { headers: serviceHeaders }
  );
  const usernameRows = usernameCheck.ok ? await usernameCheck.json() as Array<{ id: string }> : [];
  if (usernameRows.length) return json({ error: "That username is already taken. Try another." }, 400);

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
      username,
      employee_id: body.employeeId || null,
      role,
      team_id: body.teamId || null,
      can_view_all_work: Boolean(body.canViewAllWork),
      is_admin: Boolean(body.isAdmin),
      active: true,
      must_change_password: true,
    }),
  });
  if (!staffInsert.ok) {
    // Roll back the auth user so we don't leave an orphaned login with no staff record.
    await fetch(`${supabaseUrl}/auth/v1/admin/users/${createdUser.id}`, { method: "DELETE", headers: serviceHeaders });
    const errorText = await staffInsert.text();
    const duplicateUsername = /username_lower/i.test(errorText);
    const duplicateEmail = /duplicate key|unique constraint/i.test(errorText) && !duplicateUsername;
    return json({
      error: duplicateUsername
        ? "That username is already taken. Try another."
        : duplicateEmail
          ? "That email is already on your staff list."
          : `Could not save the staff record: ${errorText}`,
    }, 400);
  }
  const [staffRow] = await staffInsert.json() as Array<Record<string, unknown>>;

  // Email the login details as a convenience/backup. The owner still sees the password on-screen
  // right away (the reliable path for "get this person logged in right now") — this just saves a
  // manual hand-off when it works, and never blocks account creation if it doesn't.
  let emailSent = false;
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(request.url).origin;
      const fromEmail = `${businessName} <notifications@allegiantautocare.com>`;
      const replyToEmail = shopSettings.business_email || undefined;
      const emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: fromEmail,
          to: [email],
          ...(replyToEmail ? { reply_to: replyToEmail } : {}),
          subject: `Your ${businessName} login`,
          text: `Hi ${name},\n\n${businessName} set up a login for you.\n\nUsername: ${username}\nTemporary password: ${tempPassword}\n\nSign in here: ${siteUrl}\n\nYou'll be asked to set your own password the first time you sign in.\nThis email address is only used to reset your password if you forget it later.`,
          html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#102a4c"><h2 style="margin-bottom:4px">${escapeHtml(businessName)}</h2><p>Hi ${escapeHtml(name)}, an account was set up for you.</p><table role="presentation" cellspacing="0" cellpadding="0" style="margin:18px 0;background:#edf4ff;border-radius:8px"><tr><td style="padding:16px 20px"><div style="font-size:12px;text-transform:uppercase;color:#64748b">Username</div><div style="font-size:20px;font-weight:700;margin-bottom:10px">${escapeHtml(username)}</div><div style="font-size:12px;text-transform:uppercase;color:#64748b">Temporary password</div><div style="font-size:20px;font-weight:700">${escapeHtml(tempPassword)}</div></td></tr></table><p><a href="${escapeHtml(siteUrl)}" target="_blank" rel="noopener noreferrer" style="color:#2459a9">Sign in here</a></p><p style="color:#64748b;font-size:13px">You'll be asked to set your own password the first time you sign in. This email address is only used to reset your password if you ever forget it.</p></div>`,
        }),
      });
      emailSent = emailResponse.ok;
    } catch {
      emailSent = false;
    }
  }

  return json({ message: "Staff account created.", tempPassword, emailSent, staff: staffRow });
}

export default async (request: Request) => {
  try {
    return await handler(request);
  } catch (error) {
    await notifyError("invite-staff", error, request);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};
