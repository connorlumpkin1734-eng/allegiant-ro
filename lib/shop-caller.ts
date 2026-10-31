// Who is calling, for functions that send things to customers (estimate, invoice, inspection).
// The shop owner, a service advisor or an admin staff member may send on behalf of the shop.
// Technicians may not: sending to customers is the advisor's job.

export async function resolveCustomerSender(
  supabaseUrl: string,
  serviceHeaders: Record<string, string>,
  callerId: string
): Promise<{ ownerId: string } | { error: string; status: number }> {
  const selfResponse = await fetch(`${supabaseUrl}/rest/v1/settings?select=owner_id&owner_id=eq.${encodeURIComponent(callerId)}&limit=1`, { headers: serviceHeaders });
  const isOwner = selfResponse.ok && (await selfResponse.json() as unknown[]).length > 0;
  if (isOwner) return { ownerId: callerId };

  const staffResponse = await fetch(
    `${supabaseUrl}/rest/v1/staff?select=owner_id,role,is_admin&auth_user_id=eq.${encodeURIComponent(callerId)}&active=eq.true&limit=1`,
    { headers: serviceHeaders }
  );
  const staff = (staffResponse.ok ? await staffResponse.json() as Array<{ owner_id: string; role: string; is_admin: boolean }> : [])[0];
  if (!staff) return { error: "Sign in again.", status: 401 };
  if (staff.role !== "service_advisor" && !staff.is_admin) {
    return { error: "Only the shop owner or a service advisor can send this to the customer.", status: 403 };
  }
  return { ownerId: staff.owner_id };
}

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;

/** The address typed in the Send panel (if any), else the customer's email on file. */
export function pickRecipient(typed: unknown, onFile: string | null | undefined): { email: string } | { error: string } {
  const entered = typeof typed === "string" ? typed.trim() : "";
  if (entered) return EMAIL.test(entered) ? { email: entered } : { error: `"${entered}" doesn't look like an email address.` };
  const saved = (onFile ?? "").trim();
  return saved ? { email: saved } : { error: "Add the customer's email address before sending." };
}
