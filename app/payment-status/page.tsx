"use client";
import { useEffect, useState } from "react";

// Public, no-login page customers land on after paying an invoice through a Stripe Checkout
// link sent by email or text — either from "Collect payment" or "Email Invoice". Without this,
// Stripe's success/cancel redirect sent customers to the app's own home screen, which shows a
// staff sign-in wall and looks broken to someone who was never supposed to have an account.
export default function PaymentStatusPage() {
  const [status, setStatus] = useState<"success" | "canceled" | "">("");
  const [business, setBusiness] = useState("");
  const [roNumber, setRoNumber] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawStatus = params.get("status");
    setStatus(rawStatus === "success" || rawStatus === "canceled" ? rawStatus : "");
    setBusiness(params.get("business") || "");
    setRoNumber(params.get("ro_number") || "");
  }, []);

  const isSuccess = status === "success";
  const isCanceled = status === "canceled";

  return (
    <main className="approval-shell">
      <article className="approval-card" style={{ maxWidth: 520, textAlign: "center" }}>
        <div style={{ fontSize: 46, marginBottom: 8 }}>{isSuccess ? "✅" : isCanceled ? "⚠️" : "ℹ️"}</div>
        <h2 style={{ margin: "0 0 10px" }}>
          {isSuccess ? "Payment received" : isCanceled ? "Payment not completed" : "Payment status"}
        </h2>
        <p style={{ color: "#586578", margin: 0 }}>
          {isSuccess
            ? `Thank you${business ? ` — ${business}` : ""} has received your payment${roNumber ? ` for invoice #${roNumber}` : ""}.`
            : isCanceled
              ? "Your payment wasn't completed and no charge was made. You can close this window and use the link again to try, or contact the shop for another way to pay."
              : "There's nothing to show here yet."}
        </p>
        <p style={{ color: "#8493a6", fontSize: 13, marginTop: 24 }}>You can close this window now.</p>
      </article>
    </main>
  );
}
