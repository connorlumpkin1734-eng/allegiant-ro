// One customer link per inspection. The first send creates it; every later send (on its own or
// included with an estimate) reuses it, so the customer only ever has one link to their report.
// The public report still looks the inspection up by the SHA-256 hash of the token.

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type InspectionShare = {
  url: string;
  needsWork: number;
  watch: number;
  good: number;
  recommendations: string;
};

type InspectionRow = {
  id: string;
  data: Record<string, unknown> | null;
  share_token: string | null;
  share_token_hash: string | null;
};

/** Null when the RO has no saved inspection. Throws if the link can't be recorded. */
export async function getInspectionShare({
  supabaseUrl,
  serviceHeaders,
  repairOrderId,
  ownerId,
  siteUrl,
  customerEmail,
}: {
  supabaseUrl: string;
  serviceHeaders: Record<string, string>;
  repairOrderId: string;
  ownerId: string;
  siteUrl: string;
  customerEmail: string;
}): Promise<InspectionShare | null> {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/multipoint_inspections?select=id,data,share_token,share_token_hash&repair_order_id=eq.${encodeURIComponent(repairOrderId)}&owner_id=eq.${encodeURIComponent(ownerId)}&limit=1`,
    { headers: serviceHeaders }
  );
  const rows = response.ok ? await response.json() as InspectionRow[] : [];
  const inspection = rows[0];
  if (!inspection?.data || Object.keys(inspection.data).length === 0) return null;

  let token = inspection.share_token;
  const update: Record<string, unknown> = { shared_at: new Date().toISOString(), shared_to_email: customerEmail };
  if (!token) {
    token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
    update.share_token = token;
    update.share_token_hash = await hashToken(token);
  } else if (!inspection.share_token_hash) {
    update.share_token_hash = await hashToken(token);
  }
  const updateResponse = await fetch(`${supabaseUrl}/rest/v1/multipoint_inspections?id=eq.${inspection.id}`, {
    method: "PATCH",
    headers: serviceHeaders,
    body: JSON.stringify(update),
  });
  if (!updateResponse.ok) throw new Error(`Could not create the inspection link: ${await updateResponse.text()}`);

  const link = new URL("/inspection-report/", siteUrl);
  link.searchParams.set("token", token);

  const values = Object.values((inspection.data.items ?? {}) as Record<string, { status?: string } | null>);
  const count = (status: string) => values.filter((value) => value?.status === status).length;
  return {
    url: link.toString(),
    needsWork: count("service"),
    watch: count("monitor"),
    good: count("good"),
    recommendations: String(inspection.data.recommendations ?? "").trim(),
  };
}

/** The three colored boxes: needs attention / keep an eye on / looks good. */
export function inspectionSummaryHtml(share: InspectionShare): string {
  if (!share.needsWork && !share.watch && !share.good) return "";
  const stat = (number: number, label: string, color: string, tint: string) => `<td width="33%" align="center" style="padding:14px 6px;background:${tint};border-radius:10px">
      <div style="font-family:Arial,sans-serif;font-size:28px;font-weight:800;color:${color}">${number}</div>
      <div style="font-family:Arial,sans-serif;font-size:12px;font-weight:700;color:${color}">${label}</div>
    </td>`;
  return `<table role="presentation" width="100%" cellspacing="6" cellpadding="0" border="0" style="margin:0 0 18px"><tr>
      ${stat(share.needsWork, "Needs attention", "#b91c1c", "#fef2f2")}
      ${stat(share.watch, "Keep an eye on", "#b45309", "#fffbeb")}
      ${stat(share.good, "Looks good", "#15803d", "#f0fdf4")}
    </tr></table>`;
}
