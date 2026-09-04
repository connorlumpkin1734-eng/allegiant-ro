"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type QuoteStatus = "new" | "reviewing" | "quoted" | "converted" | "closed";
type QuoteRequest = {
  id: string;
  request_type: "quote" | "second_opinion";
  status: QuoteStatus;
  name: string;
  phone: string | null;
  email: string | null;
  preferred_contact: "phone" | "text" | "email" | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vin: string;
  mileage: number | null;
  request_text: string | null;
  converted_ro_id: string | null;
  created_at: string;
};

type QuoteFile = {
  id: string;
  quote_request_id: string;
  file_kind: "quote" | "vehicle_photo" | "vin_photo";
  storage_path: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  created_at: string;
  signed_url?: string;
};

function vehicleLabel(request: QuoteRequest) {
  return [request.vehicle_year, request.vehicle_make, request.vehicle_model].filter(Boolean).join(" ") || "Vehicle not entered";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

const badgeStyle = (status: QuoteStatus): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: ".04em",
  background: status === "new" ? "#fee2e2" : status === "converted" ? "#dcfce7" : "#e2e8f0",
  color: status === "new" ? "#991b1b" : status === "converted" ? "#166534" : "#334155",
});

export default function QuoteRequestsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [requests, setRequests] = useState<QuoteRequest[]>([]);
  const [files, setFiles] = useState<QuoteFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      if (!authLoading) setLoading(false);
      return;
    }
    void loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, authLoading]);

  async function loadRequests() {
    setLoading(true);
    setError("");
    const [requestResult, fileResult] = await Promise.all([
      supabase.from("quote_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("quote_request_files").select("*").order("created_at", { ascending: true }),
    ]);
    const firstError = requestResult.error || fileResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }
    const loaded = (requestResult.data ?? []) as QuoteRequest[];
    setRequests(loaded);
    setFiles((fileResult.data ?? []) as QuoteFile[]);
    setSelectedId((current) => current && loaded.some((entry) => entry.id === current) ? current : loaded[0]?.id ?? null);
    setLoading(false);
  }

  const selected = requests.find((entry) => entry.id === selectedId) ?? null;
  const selectedFiles = useMemo(() => files.filter((file) => file.quote_request_id === selectedId), [files, selectedId]);
  const newCount = requests.filter((entry) => entry.status === "new").length;

  async function setStatus(request: QuoteRequest, status: QuoteStatus) {
    setBusy(true);
    setMessage("");
    const { error: updateError } = await supabase
      .from("quote_requests")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", request.id);
    if (updateError) setError(updateError.message);
    else await loadRequests();
    setBusy(false);
  }

  async function openFile(file: QuoteFile) {
    setError("");
    const { data, error: signError } = await supabase.storage
      .from("quote-request-files")
      .createSignedUrl(file.storage_path, 300);
    if (signError || !data?.signedUrl) {
      setError(signError?.message || "Could not open that attachment.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function convertToRo(request: QuoteRequest) {
    if (!session) return;
    if (request.converted_ro_id) {
      setMessage("This quote request has already been converted to a work order.");
      return;
    }
    if (!window.confirm(`Create a new Allegiant RO for ${request.name}?`)) return;

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { data: settings } = await supabase.from("settings").select("sales_tax_rate").maybeSingle();
      const { data: customer, error: customerError } = await supabase
        .from("customers")
        .insert({
          owner_id: session.user.id,
          name: request.name,
          phone: request.phone,
          email: request.email,
          address_line_1: null,
          address_line_2: null,
          city: null,
          state: "TX",
          zip_code: null,
          notes: `Created from website quote request ${request.id}.`,
        })
        .select("id")
        .single();
      if (customerError || !customer) throw customerError || new Error("Customer could not be created.");

      const { data: vehicle, error: vehicleError } = await supabase
        .from("vehicles")
        .insert({
          owner_id: session.user.id,
          customer_id: customer.id,
          year: request.vehicle_year,
          make: request.vehicle_make,
          model: request.vehicle_model,
          trim: null,
          engine: null,
          vin: request.vin,
          license_plate: null,
          plate_state: "TX",
          color: null,
          notes: "Submitted through AllegiantAutoCare.com quote request.",
          vin_data: null,
        })
        .select("id")
        .single();
      if (vehicleError || !vehicle) throw vehicleError || new Error("Vehicle could not be created.");

      const note = request.request_type === "second_opinion"
        ? "Website second-opinion request. Original shop estimate/photos are stored under Quote Requests."
        : "Website quote request. Submitted files are stored under Quote Requests.";
      const { data: ro, error: roError } = await supabase
        .from("repair_orders")
        .insert({
          owner_id: session.user.id,
          customer_id: customer.id,
          vehicle_id: vehicle.id,
          document_type: "repair_order",
          status: "open",
          mileage_in: request.mileage,
          mileage_out: null,
          customer_concern: request.request_text || "Customer requested a quote through AllegiantAutoCare.com.",
          notes: note,
          paid: false,
          paid_at: null,
          tax_rate: Number(settings?.sales_tax_rate ?? 0),
        })
        .select("id, ro_number")
        .single();
      if (roError || !ro) throw roError || new Error("Work order could not be created.");

      const { error: requestError } = await supabase
        .from("quote_requests")
        .update({ status: "converted", converted_ro_id: ro.id, updated_at: new Date().toISOString() })
        .eq("id", request.id);
      if (requestError) throw requestError;

      setMessage(`Created RO #${String(ro.ro_number).padStart(4, "0")}. It is now at the top of Work Orders.`);
      await loadRequests();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not convert this request to a work order.");
    } finally {
      setBusy(false);
    }
  }

  if (authLoading) return <div className="center-screen">Loading quote requests…</div>;
  if (!session) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>Quote Requests</h1>
          <p className="muted">Sign in to Allegiant RO first.</p>
          <a className="button primary" href="/">Go to sign in</a>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar no-print">
        <a href="/" style={{ display: "flex", alignItems: "center" }}>
          <img className="topbar-logo" src="/allegiant-auto-care-logo.png" alt="Allegiant Auto Care" />
        </a>
        <nav>
          <a href="/" style={{ color: "inherit", textDecoration: "none" }}>Work Orders</a>
          <a href="/quote-requests" className="active" style={{ color: "inherit", textDecoration: "none" }}>Quote Requests {newCount ? `(${newCount})` : ""}</a>
        </nav>
        <button className="button secondary" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>

      <main className="main-area">
        {error && <div className="error-banner no-print">{error}</div>}
        {message && <div className="notice no-print">{message}</div>}
        <div className="page-heading">
          <div>
            <h1>Website Quote Requests</h1>
            <p>VIN-first quote leads, second-opinion estimates, and customer-uploaded photos from AllegiantAutoCare.com.</p>
          </div>
          <a className="button secondary" href="/">Back to Work Orders</a>
        </div>

        {loading ? <div className="panel">Loading requests…</div> : requests.length === 0 ? (
          <div className="panel"><strong>No quote requests yet.</strong><p className="muted">New website submissions will land here automatically.</p></div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, .85fr) minmax(420px, 1.4fr)", gap: 20, alignItems: "start" }}>
            <section className="panel" style={{ padding: 0, overflow: "hidden" }}>
              {requests.map((request) => (
                <button
                  key={request.id}
                  onClick={() => setSelectedId(request.id)}
                  style={{
                    width: "100%", textAlign: "left", border: 0, borderBottom: "1px solid #e2e8f0", padding: 16,
                    background: selectedId === request.id ? "#f8fafc" : "white", cursor: "pointer", color: "inherit",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <strong>{request.name}</strong><span style={badgeStyle(request.status)}>{request.status}</span>
                  </div>
                  <div style={{ marginTop: 6 }}>{vehicleLabel(request)}</div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{formatDate(request.created_at)}</div>
                </button>
              ))}
            </section>

            {selected && (
              <section className="panel">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
                  <div>
                    <h2 style={{ marginTop: 0, marginBottom: 4 }}>{selected.name}</h2>
                    <div className="muted">{selected.request_type === "second_opinion" ? "Second opinion / outside quote review" : "Quote request"} · {formatDate(selected.created_at)}</div>
                  </div>
                  <span style={badgeStyle(selected.status)}>{selected.status}</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12, marginTop: 20 }}>
                  <Info label="Phone" value={selected.phone || "—"} />
                  <Info label="Email" value={selected.email || "—"} />
                  <Info label="Vehicle" value={vehicleLabel(selected)} />
                  <Info label="Mileage" value={selected.mileage ? selected.mileage.toLocaleString() : "—"} />
                  <Info label="VIN" value={selected.vin} wide />
                  <Info label="Preferred contact" value={selected.preferred_contact || "No preference"} />
                </div>

                <div style={{ marginTop: 20 }}>
                  <strong>Customer request</strong>
                  <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{selected.request_text || "No additional description provided."}</p>
                </div>

                <div style={{ marginTop: 20 }}>
                  <strong>Uploads ({selectedFiles.length})</strong>
                  {selectedFiles.length === 0 ? <p className="muted">No files attached.</p> : (
                    <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                      {selectedFiles.map((file) => (
                        <button key={file.id} className="button secondary" style={{ justifyContent: "space-between" }} onClick={() => void openFile(file)}>
                          <span>{file.file_kind === "quote" ? "Outside quote" : file.file_kind === "vin_photo" ? "VIN photo" : "Vehicle photo"}: {file.original_name}</span>
                          <span className="muted">{formatBytes(file.file_size)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 24 }}>
                  {selected.status === "new" && <button className="button secondary" disabled={busy} onClick={() => void setStatus(selected, "reviewing")}>Mark reviewing</button>}
                  {selected.status !== "converted" && selected.status !== "closed" && <button className="button secondary" disabled={busy} onClick={() => void setStatus(selected, "quoted")}>Mark quoted</button>}
                  {selected.status !== "converted" && <button className="button primary" disabled={busy} onClick={() => void convertToRo(selected)}>Convert to RO</button>}
                  {selected.status !== "converted" && <button className="button secondary" disabled={busy} onClick={() => void setStatus(selected, "closed")}>Close request</button>}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function Info({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div style={{ gridColumn: wide ? "1 / -1" : undefined, border: "1px solid #e2e8f0", borderRadius: 10, padding: 12 }}>
      <div className="muted" style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</div>
      <div style={{ marginTop: 4, fontWeight: 650, overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );
}
