// What a customer still owes on an invoice once payments already received are taken off.
// Counter payments (cash, check, the shop's own card terminal) are recorded by hand as
// processor "manual"; online ones are written by the Stripe/Square/Zelle flows. Only rows
// with status "succeeded" count: pending, failed and refunded payments don't reduce the balance.
// Every place that charges or quotes an amount to the customer must use this, so a deposit
// taken at the counter is never charged again online.

export type PaymentAmountRow = { amount: number | string | null; status: string };

const cents = (value: number | string | null | undefined) => Math.round(Number(value || 0) * 100);

export function balanceAfterPayments(
  invoiceTotal: number,
  payments: PaymentAmountRow[] | null | undefined
): { received: number; balance: number } {
  const receivedCents = (payments ?? []).reduce((sum, payment) => sum + (payment.status === "succeeded" ? cents(payment.amount) : 0), 0);
  return {
    received: receivedCents / 100,
    balance: Math.max(0, cents(invoiceTotal) - receivedCents) / 100,
  };
}
