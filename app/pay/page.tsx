"use client";
import { useEffect, useState } from "react";

// Public, no-login page the customer lands on from the invoice email (or a link the shop sends).
// One link, one choice: pay by card / bank transfer (Stripe) or by Zelle. Nothing here marks the
// invoice paid — Stripe's webhook does that for card/bank, and the shop confirms Zelle by hand.
type Info = {
  businessName: string;
  roNumber: number | null;
  amount: number;
  alreadyPaid: boolean;
  methods: { card: boolean; zelle: boolean };
};

export default function PayPage() {
  const [token, setToken] = useState("");
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"" | "card" | "zelle">("");

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("token") || "";
    setToken(value);
    if (!value) {
      setError("This payment link is invalid.");
      setLoading(false);
      return;
    }
    fetch(`/.netlify/functions/pay-invoice?token=${encodeURIComponent(value)}`)
      .then(async (response) => {
        const body = await response.json() as Info & { error?: string };
        if (!response.ok) throw new Error(body.error || "This payment link is invalid.");
        setInfo(body);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "This payment link is invalid."))
      .finally(() => setLoading(false));
  }, []);

  async function choose(method: "card" | "zelle") {
    setBusy(method);
    setError("");
    try {
      const response = await fetch("/.netlify/functions/pay-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, method }),
      });
      const body = await response.json() as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error || "Something went wrong. Please try again.");
      window.location.href = body.url;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
      setBusy("");
    }
  }

  const roLabel = info?.roNumber ? `#${String(info.roNumber).padStart(4, "0")}` : "";
  const amount = info ? info.amount.toLocaleString("en-US", { style: "currency", currency: "usd" }) : "";
  const noMethods = info && !info.methods.card && !info.methods.zelle;

  return (
    <main className="approval-shell">
      <article className="approval-card" style={{ maxWidth: 520, textAlign: "center" }}>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : !info ? (
          <>
            <div style={{ fontSize: 46, marginBottom: 8 }}>⚠️</div>
            <h2 style={{ margin: "0 0 10px" }}>Can&apos;t load this payment</h2>
            <p style={{ color: "#586578" }}>{error}</p>
          </>
        ) : info.alreadyPaid ? (
          <>
            <div style={{ fontSize: 46, marginBottom: 8 }}>✅</div>
            <h2 style={{ margin: "0 0 10px" }}>Already paid</h2>
            <p style={{ color: "#586578" }}>This invoice{roLabel ? ` ${roLabel}` : ""} has already been paid. Thank you! You can close this window.</p>
          </>
        ) : (
          <>
            <h2 style={{ margin: "0 0 4px" }}>Pay {info.businessName}</h2>
            {roLabel && <p style={{ color: "#8493a6", fontSize: 13, marginTop: 0 }}>Invoice {roLabel}</p>}
            <div style={{ background: "#edf4ff", borderRadius: 10, padding: "18px 20px", margin: "18px 0", textAlign: "left" }}>
              <div style={{ fontSize: 12, textTransform: "uppercase", color: "#64748b" }}>Amount due</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{amount}</div>
            </div>
            {noMethods ? (
              <p style={{ color: "#586578" }}>Online payment isn&apos;t available for this invoice. Please contact {info.businessName} to arrange payment.</p>
            ) : (
              <>
                <p style={{ color: "#586578", fontSize: 14, marginTop: 0 }}>How would you like to pay?</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {info.methods.card && (
                    <button type="button" className="button primary" disabled={Boolean(busy)} onClick={() => void choose("card")} style={{ minHeight: 48 }}>
                      {busy === "card" ? "Opening secure checkout…" : "Pay by card or bank transfer"}
                    </button>
                  )}
                  {info.methods.zelle && (
                    <button type="button" className={`button ${info.methods.card ? "secondary" : "primary"}`} disabled={Boolean(busy)} onClick={() => void choose("zelle")} style={{ minHeight: 48 }}>
                      {busy === "zelle" ? "Working…" : "Pay with Zelle"}
                    </button>
                  )}
                </div>
                {error && <p style={{ color: "#b21f2d", fontSize: 14 }}>{error}</p>}
              </>
            )}
          </>
        )}
      </article>
    </main>
  );
}
