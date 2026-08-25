"use client";

import { PointerEvent, useEffect, useRef, useState } from "react";

type Snapshot = {
  roNumber: number;
  customerName: string;
  vehicle: string;
  vin: string;
  items: Array<{ description: string; quantity: number; unit_price: number; service_group_id?: string | null; service_group_title?: string | null }>;
  photos?: Array<{ service_group_id: string; caption?: string | null; url?: string | null }>;
  subtotal: number;
  tax: number;
  total: number;
  businessName: string;
  businessPhone: string;
  businessEmail: string;
};

type Authorization = { status: string; estimate_snapshot: Snapshot; responded_at?: string | null };
const money = (amount: number) => Number(amount || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function EstimateApprovalPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const signed = useRef(false);
  const [token, setToken] = useState("");
  const [authorization, setAuthorization] = useState<Authorization | null>(null);
  const [signerName, setSignerName] = useState("");
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState("Loading estimate…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const linkToken = new URLSearchParams(window.location.search).get("token") || "";
    setToken(linkToken);
    if (!linkToken) { setMessage("This approval link is invalid."); return; }
    fetch(`/.netlify/functions/estimate-approval?token=${encodeURIComponent(linkToken)}`)
      .then(async (response) => {
        const body = await response.json() as { authorization?: Authorization; error?: string };
        if (!response.ok || !body.authorization) throw new Error(body.error || "Estimate not found.");
        setAuthorization(body.authorization);
        setSignerName(body.authorization.estimate_snapshot.customerName || "");
        setMessage("");
      })
      .catch((error: Error) => setMessage(error.message));
  }, []);

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) };
  }

  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(event.pointerId);
    const context = canvas.getContext("2d")!;
    const current = point(event);
    context.beginPath(); context.moveTo(current.x, current.y);
    drawing.current = true; signed.current = true;
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const context = canvasRef.current!.getContext("2d")!;
    const current = point(event);
    context.lineWidth = 3; context.lineCap = "round"; context.strokeStyle = "#102a4c";
    context.lineTo(current.x, current.y); context.stroke();
  }

  function clearSignature() {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    signed.current = false;
  }

  async function respond(action: "approved" | "declined") {
    if (action === "approved" && (!signerName.trim() || !consent || !signed.current)) {
      setMessage("Enter your name, sign the box, and check the authorization statement.");
      return;
    }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/.netlify/functions/estimate-approval", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token, action, signerName,
          consent: action === "approved" ? consent : false,
          signatureData: action === "approved" ? canvasRef.current!.toDataURL("image/png") : null,
        }),
      });
      const body = await response.json() as { error?: string; status?: string };
      if (!response.ok) throw new Error(body.error || "Your response could not be saved.");
      setAuthorization((current) => current ? { ...current, status: body.status || action, responded_at: new Date().toISOString() } : current);
      setMessage(action === "approved" ? "Estimate approved. Allegiant Auto Care has received your authorization." : "Estimate declined. Allegiant Auto Care has received your response.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Your response could not be saved.");
    } finally { setBusy(false); }
  }

  const snapshot = authorization?.estimate_snapshot;
  return (
    <main className="approval-shell">
      <section className="approval-card">
        <img className="approval-logo" src="/allegiant-auto-care-logo.png" alt="Allegiant Auto Care" />
        {!snapshot ? <div className="notice">{message}</div> : (
          <>
            <h1>Estimate #{String(snapshot.roNumber).padStart(4, "0")}</h1>
            <div className="approval-summary">
              <div><span>Customer</span><strong>{snapshot.customerName}</strong></div>
              <div><span>Vehicle</span><strong>{snapshot.vehicle || "—"}</strong></div>
              {snapshot.vin && <div><span>VIN</span><strong>{snapshot.vin}</strong></div>}
              <div><span>Estimate total</span><strong>{money(snapshot.total)}</strong></div>
            </div>
            <div className="approval-jobs">
              {snapshot.items.map((item, index) => {
                const groupPhotos = (snapshot.photos ?? []).filter((photo) => photo.service_group_id === item.service_group_id && photo.url);
                const lastInGroup = item.service_group_id && !snapshot.items.slice(index + 1).some((next) => next.service_group_id === item.service_group_id);
                return <div key={`${item.description}-${index}`}>
                  <div className="approval-job">
                    <div><strong>{item.description}</strong>{item.quantity !== 1 && <div className="muted">Qty {item.quantity}</div>}</div>
                    <strong>{money(item.quantity * item.unit_price)}</strong>
                  </div>
                  {lastInGroup && groupPhotos.length > 0 && <div className="estimate-photo-grid">
                    {groupPhotos.map((photo, photoIndex) => <figure className="estimate-photo" key={`${photo.url}-${photoIndex}`}>
                      <img src={photo.url!} alt={photo.caption || item.service_group_title || "Repair photo"} />
                      {photo.caption && <figcaption>{photo.caption}</figcaption>}
                    </figure>)}
                  </div>}
                </div>;
              })}
              <div className="approval-job"><span>Subtotal</span><strong>{money(snapshot.subtotal)}</strong></div>
              <div className="approval-job"><span>Tax</span><strong>{money(snapshot.tax)}</strong></div>
              <div className="approval-job"><strong>Total</strong><strong>{money(snapshot.total)}</strong></div>
            </div>
            {authorization.status === "sent" ? (
              <>
                <label>Full name<input value={signerName} onChange={(event) => setSignerName(event.target.value)} /></label>
                <label>Signature</label>
                <canvas ref={canvasRef} className="signature-pad" width={900} height={220}
                  onPointerDown={startDrawing} onPointerMove={draw}
                  onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} />
                <button className="button small ghost" type="button" onClick={clearSignature}>Clear signature</button>
                <label className="checkbox-row" style={{ marginTop: 16 }}>
                  <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                  I authorize Allegiant Auto Care to perform the work listed above for the displayed estimate total. Additional work requires separate approval.
                </label>
                <div className="approval-actions">
                  <button className="button primary" disabled={busy} onClick={() => void respond("approved")}>Approve and sign</button>
                  <button className="button danger" disabled={busy} onClick={() => void respond("declined")}>Decline estimate</button>
                </div>
              </>
            ) : <div className={`notice badge estimate-${authorization.status}`}>This estimate was {authorization.status}.</div>}
            {message && <div className="notice" style={{ marginTop: 16 }}>{message}</div>}
          </>
        )}
      </section>
    </main>
  );
}
