// Creates a Checkout Session on a shop's connected Stripe account. Card + US bank account is
// tried first; a live account that hasn't turned on ACH (or any other payment-method problem)
// falls back to card only, so a shop's Stripe settings can't block getting paid.
export type CheckoutSession = { id?: string; url?: string; error?: { message?: string } };

export async function createConnectedCheckout(secretKey: string, accountId: string, params: URLSearchParams) {
  const attempt = async (methods: string[]) => {
    const body = new URLSearchParams(params);
    methods.forEach((m, i) => body.set(`payment_method_types[${i}]`, m));
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Account": accountId },
      body,
    });
    const session = await response.json() as CheckoutSession;
    return { ok: response.ok && Boolean(session.id && session.url), session };
  };
  let result = await attempt(["card", "us_bank_account"]);
  if (!result.ok) {
    console.error("Stripe checkout (card+ACH) failed:", result.session.error?.message);
    result = await attempt(["card"]);
    if (!result.ok) console.error("Stripe checkout (card) failed:", result.session.error?.message);
  }
  return result;
}
