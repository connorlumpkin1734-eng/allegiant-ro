// Creates a Checkout Session on a shop's connected Stripe account. Payment methods are not
// listed here: current Stripe API versions reject `payment_method_types` and use whatever the
// shop has turned on in its own Stripe Dashboard (Settings → Payment methods).
export type CheckoutSession = { id?: string; url?: string; error?: { message?: string } };

export async function createConnectedCheckout(secretKey: string, accountId: string, params: URLSearchParams) {
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Account": accountId },
    body: params,
  });
  const session = await response.json() as CheckoutSession;
  const ok = response.ok && Boolean(session.id && session.url);
  if (!ok) console.error("Stripe checkout failed:", session.error?.message);
  return { ok, session };
}
