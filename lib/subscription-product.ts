// The one Stripe product every shop's ROrunner subscription is billed under. Each shop still gets
// its own price (price_data per subscription); the product just has to exist and stay active,
// because Stripe won't attach new prices to the inactive products it creates for inline
// product_data at checkout. Created on first use with a fixed id, so there's nothing to configure.
export const SUBSCRIPTION_PRODUCT_ID = "rorunner_subscription";

export async function ensureSubscriptionProduct(stripeSecretKey: string): Promise<string> {
  const headers = { Authorization: `Bearer ${stripeSecretKey}` };
  const existing = await fetch(`https://api.stripe.com/v1/products/${SUBSCRIPTION_PRODUCT_ID}`, { headers });
  if (existing.ok) {
    const product = await existing.json() as { active?: boolean };
    if (product.active === false) {
      await fetch(`https://api.stripe.com/v1/products/${SUBSCRIPTION_PRODUCT_ID}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ active: "true" }),
      });
    }
    return SUBSCRIPTION_PRODUCT_ID;
  }
  const created = await fetch("https://api.stripe.com/v1/products", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id: SUBSCRIPTION_PRODUCT_ID, name: "ROrunner subscription" }),
  });
  if (!created.ok) {
    const body = await created.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message || "Could not set up the ROrunner subscription product in Stripe.");
  }
  return SUBSCRIPTION_PRODUCT_ID;
}
