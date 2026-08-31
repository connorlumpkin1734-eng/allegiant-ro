"use client";
import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";

type Decision = "approved" | "declined";
type Item = { description: string; quantity: number; unit_price: number; taxable?: boolean; service_group_id?: string | null; service_group_title?: string | null; technician_story?: string | null };
type Snapshot = { roNumber: number; customerName: string; vehicle: string; vin: string; estimateDate?: string; customerConcern?: string; items: Item[]; photos?: Array<{ service_group_id: string; caption?: string | null; url?: string | null }>; subtotal: number; tax: number; total: number; taxRate?: number; businessName: string; businessAddress?: string; businessPhone: string; businessEmail: string };
type Authorization = { status: string; estimate_snapshot: Snapshot; line_decisions?: Record<string, Decision>; approved_total?: number | null; responded_at?: string | null };
type Group = { id: string; title: string; recommendation: string; items: Item[] };
const money = (amount: number) => Number(amount || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function EstimateApprovalPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null); const drawing = useRef(false); const signed = useRef(false);
  const [token, setToken] = useState(""); const [authorization, setAuthorization] = useState<Authorization | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({}); const [signerName, setSignerName] = useState("");
  const [consent, setConsent] = useState(false); const [message, setMessage] = useState("Loading estimate…"); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const linkToken = new URLSearchParams(window.location.search).get("token") || ""; setToken(linkToken);
    if (!linkToken) { setMessage("This approval link is invalid."); return; }
    fetch(`/.netlify/functions/estimate-approval?token=${encodeURIComponent(linkToken)}`).then(async (response) => {
      const body = await response.json() as { authorization?: Authorization; error?: string };
      if (!response.ok || !body.authorization) throw new Error(body.error || "Estimate not found.");
      setAuthorization(body.authorization); setDecisions(body.authorization.line_decisions ?? {}); setSignerName(body.authorization.estimate_snapshot.customerName || ""); setMessage("");
    }).catch((error: Error) => setMessage(error.message));
  }, []);
  const snapshot = authorization?.estimate_snapshot;
  const groups = useMemo(() => {
    const result: Group[] = []; const byId = new Map<string, Group>();
    for (const item of snapshot?.items ?? []) {
      if (!item.service_group_id) continue;
      let group = byId.get(item.service_group_id);
      if (!group) { group = { id: item.service_group_id, title: item.service_group_title || "Recommended Service", recommendation: item.technician_story || "", items: [] }; byId.set(group.id, group); result.push(group); }
      group.items.push(item);
    }
    return result;
  }, [snapshot]);
  const approvedGroups = groups.filter((group) => decisions[group.id] === "approved");
  const approvedSubtotal = (snapshot?.items ?? []).filter((item) => item.service_group_id ? decisions[item.service_group_id] === "approved" : approvedGroups.length > 0).reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const approvedTaxable = (snapshot?.items ?? []).filter((item) => (item.service_group_id ? decisions[item.service_group_id] === "approved" : approvedGroups.length > 0) && item.taxable).reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const approvedTotal = approvedSubtotal + Math.max(0, approvedTaxable) * (Number(snapshot?.taxRate || 0) / 100);
  function point(event: PointerEvent<HTMLCanvasElement>) { const canvas = canvasRef.current!; const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }; }
  function startDrawing(event: PointerEvent<HTMLCanvasElement>) { const canvas = canvasRef.current!; canvas.setPointerCapture(event.pointerId); const context = canvas.getContext("2d")!; const current = point(event); context.beginPath(); context.moveTo(current.x, current.y); drawing.current = true; signed.current = true; }
  function draw(event: PointerEvent<HTMLCanvasElement>) { if (!drawing.current) return; const context = canvasRef.current!.getContext("2d")!; const current = point(event); context.lineWidth = 3; context.lineCap = "round"; context.strokeStyle = "#102a4c"; context.lineTo(current.x, current.y); context.stroke(); }
  function clearSignature() { canvasRef.current?.getContext("2d")?.clearRect(0, 0, 900, 220); signed.current = false; }
  async function respond() {
    if (groups.some((group) => !decisions[group.id])) { setMessage("Choose approve or decline for every service."); return; }
    if (approvedGroups.length > 0 && (!signerName.trim() || !consent || !signed.current)) { setMessage("Enter your name, sign the box, and check the authorization statement."); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/.netlify/functions/estimate-approval", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, decisions, signerName, consent: approvedGroups.length > 0 ? consent : false, signatureData: approvedGroups.length > 0 ? canvasRef.current!.toDataURL("image/png") : null }) });
      const body = await response.json() as { error?: string; status?: string; approvedTotal?: number }; if (!response.ok) throw new Error(body.error || "Your response could not be saved.");
      setAuthorization((current) => current ? { ...current, status: body.status || "declined", line_decisions: decisions, approved_total: body.approvedTotal, responded_at: new Date().toISOString() } : current);
      setMessage(approvedGroups.length ? `Selections submitted. ${money(body.approvedTotal || 0)} authorized.` : "All services declined. Allegiant Auto Care has received your response.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Your response could not be saved."); } finally { setBusy(false); }
  }
  return <main className="approval-shell"><article className="approval-card document-page document-estimate">
    {!snapshot ? <div className="notice">{message}</div> : <>
      <header className="document-header"><div><img className="document-logo" src="/allegiant-auto-care-logo.png" alt="Allegiant Auto Care" />{snapshot.businessAddress && <p>{snapshot.businessAddress}</p>}<p>{[snapshot.businessPhone, snapshot.businessEmail].filter(Boolean).join(" · ")}</p></div><div className="document-title"><h2>Estimate</h2><p className="document-subtitle">Proposed work and estimated pricing</p><strong>RO #{String(snapshot.roNumber).padStart(4, "0")}</strong><span>{snapshot.estimateDate ? new Date(snapshot.estimateDate).toLocaleDateString() : ""}</span></div></header>
      <section className="document-stage-banner"><div><span className="stage-eyebrow">Proposal</span><strong>Estimated total</strong><small>Choose each service below.</small></div><b>{money(snapshot.total)}</b></section>
      <div className="document-info-grid"><section><h3>Customer</h3><strong>{snapshot.customerName}</strong></section><section><h3>Vehicle</h3><strong>{snapshot.vehicle || "—"}</strong><span>VIN: {snapshot.vin || "—"}</span></section><section><h3>Estimate details</h3><span>{groups.length} proposed service{groups.length === 1 ? "" : "s"}</span></section></div>
      {snapshot.customerConcern && <section className="concern-box"><h3>Customer request / proposed work</h3><p>{snapshot.customerConcern}</p></section>}
      <div className="document-section-heading"><h3>Proposed services</h3><span>Approve or decline each job</span></div>
      {groups.map((group) => { const groupTotal = group.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0); const photos = (snapshot.photos ?? []).filter((photo) => photo.service_group_id === group.id && photo.url); return <section className={`approval-service ${decisions[group.id] || ""}`} key={group.id}>
        <div className="approval-service-heading"><div><h3>{group.title}</h3><strong>{money(groupTotal)}</strong></div><div className="approval-choice"><button type="button" className={decisions[group.id] === "approved" ? "selected approve" : "approve"} onClick={() => setDecisions((current) => ({ ...current, [group.id]: "approved" }))} disabled={authorization.status !== "sent"}>✓ Approve</button><button type="button" className={decisions[group.id] === "declined" ? "selected decline" : "decline"} onClick={() => setDecisions((current) => ({ ...current, [group.id]: "declined" }))} disabled={authorization.status !== "sent"}>✕ Decline</button></div></div>
        {group.recommendation && <p className="approval-recommendation">{group.recommendation}</p>}
        <table className="document-table"><thead><tr><th>Description</th><th>Qty/Hrs</th><th>Est. Rate/Price</th><th>Amount</th></tr></thead><tbody>{group.items.map((item, index) => <tr key={`${item.description}-${index}`}><td>{item.description}</td><td>{item.quantity}</td><td>{money(item.unit_price)}</td><td>{money(item.quantity * item.unit_price)}</td></tr>)}</tbody></table>
        {photos.length > 0 && <div className="estimate-photo-grid">{photos.map((photo, index) => <figure className="estimate-photo" key={`${photo.url}-${index}`}><img src={photo.url!} alt={photo.caption || group.title} />{photo.caption && <figcaption>{photo.caption}</figcaption>}</figure>)}</div>}
      </section>; })}
      <div className="document-bottom"><div className="document-notes">{authorization.status === "sent" && <strong>{Object.keys(decisions).length} of {groups.length} services selected</strong>}</div><div className="document-totals"><div><span>Estimate subtotal</span><strong>{money(snapshot.subtotal)}</strong></div><div><span>Tax</span><strong>{money(snapshot.tax)}</strong></div><div className="grand-total"><span>Estimated total</span><strong>{money(snapshot.total)}</strong></div><div className="authorized-total"><span>Selected total</span><strong>{money(authorization.approved_total ?? approvedTotal)}</strong></div></div></div>
      {authorization.status === "sent" ? <section className="document-terms"><strong>Work authorization</strong>{approvedGroups.length > 0 && <><label>Full name<input value={signerName} onChange={(event) => setSignerName(event.target.value)} /></label><label>Signature</label><canvas ref={canvasRef} className="signature-pad" width={900} height={220} onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} /><button className="button small ghost" type="button" onClick={clearSignature}>Clear signature</button><label className="checkbox-row"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />I authorize Allegiant Auto Care to perform only the services I approved above for the selected total shown.</label></>}<button className="button primary approval-submit" disabled={busy} onClick={() => void respond()}>{busy ? "Submitting…" : approvedGroups.length ? `Submit selections & authorize ${money(approvedTotal)}` : "Submit declined services"}</button></section> : <div className={`notice badge estimate-${authorization.status}`}>Response recorded: {authorization.status.replaceAll("_", " ")}. Authorized total: {money(authorization.approved_total || 0)}.</div>}
      {message && <div className="notice">{message}</div>}
    </>}
  </article></main>;
}
