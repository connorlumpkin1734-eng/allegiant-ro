"use client";
import { useEffect, useState } from "react";

// Public, no-login page a customer lands on from a Zelle payment link the shop shares with them.
// Shows the shop's Zelle info and the amount due, and lets the customer say they've sent it —
// which only notifies the shop. Nothing here ever marks the invoice paid; that's a manual,
// staff-only step after someone checks the shop's own bank app (see confirm-zelle-payment.ts).
type Info = {
  businessName: string;
  zelleRecipient: string;
  amount: string;
  roNumber: number | null;
  alreadyPaid: boolean;
  alreadyClaimed: boolean;
};

export default function PayZellePage() {
  const [token, setToken] = useState("");
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("token") || "";
    setToken(value);
    if (!value) {
      setError("This payment link is invalid.");
      setLoading(false);
      return;
    }
    fetch(`/.netlify/functions/pay-zelle?token=${encodeURIComponent(value)}`)
      .then(async (response) => {
        const body = await response.json() as Info & { error?: string };
        if (!response.ok) throw new Error(body.error || "This payment link is invalid.");
        setInfo(body);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "This payment link is invalid."))
      .finally(() => setLoading(false));
  }, []);

  async function sendClaim() {
    setClaiming(true);
    try {
      const response = await fetch("/.netlify/functions/pay-zelle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not record your payment.");
      setClaimed(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not record your payment.");
    } finally {
      setClaiming(false);
    }
  }

  const roLabel = info?.roNumber ? `#${String(info.roNumber).padStart(4, "0")}` : "";
  const amount = info ? Number(info.amount).toLocaleString("en-US", { style: "currency", currency: "usd" }) : "";

  return (
    <main className="approval-shell">
      <article className="approval-card" style={{ maxWidth: 520, textAlign: "center" }}>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : error ? (
          <>
            <div style={{ fontSize: 46, marginBottom: 8 }}>⚠️</div>
            <h2 style={{ margin: "0 0 10px" }}>Can&apos;t load this payment</h2>
            <p style={{ color: "#586578" }}>{error}</p>
          </>
        ) : info?.alreadyPaid ? (
          <>
            <div style={{ fontSize: 46, marginBottom: 8 }}>✅</div>
            <h2 style={{ margin: "0 0 10px" }}>Already paid</h2>
            <p style={{ color: "#586578" }}>This invoice{roLabel ? ` ${roLabel}` : ""} has already been paid. You can close this window.</p>
          </>
        ) : claimed || info?.alreadyClaimed ? (
          <>
            <div style={{ fontSize: 46, marginBottom: 8 }}>📬</div>
            <h2 style={{ margin: "0 0 10px" }}>Thanks — {info?.businessName} has been notified</h2>
            <p style={{ color: "#586578" }}>
              They&apos;ll confirm your payment once it shows up in their bank account. You can close this window now.
            </p>
          </>
        ) : (
          <>
            <h2 style={{ margin: "0 0 4px" }}>Pay {info?.businessName} via Zelle</h2>
            {roLabel && <p style={{ color: "#8493a6", fontSize: 13, marginTop: 0 }}>Invoice {roLabel}</p>}
            <div style={{ background: "#edf4ff", borderRadius: 10, padding: "18px 20px", margin: "18px 0", textAlign: "left" }}>
              <div style={{ fontSize: 12, textTransform: "uppercase", color: "#64748b" }}>Amount due</div>
              <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 14 }}>{amount}</div>
              <div style={{ fontSize: 12, textTransform: "uppercase", color: "#64748b" }}>Send Zelle payment to</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{info?.zelleRecipient}</div>
            </div>
            <p style={{ color: "#586578", fontSize: 14 }}>
              Open your bank&apos;s app, send {amount} via Zelle to the recipient above, then tap the button below so {info?.businessName} knows to look out for it.
            </p>
            <button type="button" className="button primary" disabled={claiming} onClick={() => void sendClaim()} style={{ marginTop: 8 }}>
              {claiming ? "Working…" : "I've sent the payment"}
            </button>
          </>
        )}
      </article>
    </main>
  );
}
