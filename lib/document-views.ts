// Records a customer opening the estimate or invoice link we emailed (see document_views).
// Best effort: a failure here never affects the page the customer is loading.
const BOT_UA = /bot|crawl|spider|preview|scanner|safelinks|proofpoint|mimecast|barracuda|headless|curl|wget|python|go-http|facebookexternalhit|slackbot|whatsapp|discord/i;

export async function recordDocumentView(request: Request, supabaseUrl: string, serviceHeaders: Record<string, string>, repairOrderId: string, ownerId: string, kind: "estimate" | "invoice") {
  if (BOT_UA.test(request.headers.get("user-agent") || "")) return;
  try {
    await fetch(`${supabaseUrl}/rest/v1/rpc/record_document_view`, {
      method: "POST", headers: serviceHeaders, body: JSON.stringify({ p_repair_order_id: repairOrderId, p_owner_id: ownerId, p_kind: kind }),
    });
  } catch {
    // Ignore.
  }
}
