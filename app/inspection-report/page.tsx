"use client";

import { useEffect, useState } from "react";
import { sections, statusOptions, normalizeInspection, blankValue, type InspectionData } from "@/components/MultipointInspection";

type RepairOrder = {
  ro_number: number;
  mileage_in: number | null;
  customers?: { name: string } | null;
  vehicles?: { year: number | null; make: string | null; model: string | null; trim: string | null; vin: string | null } | null;
};
type Business = {
  name: string;
  address: string;
  phone: string;
  email: string;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
};

const statusLabel = (value: string) => statusOptions.find((option) => option.value === value)?.label || "—";

export default function InspectionReportPage() {
  const [data, setData] = useState<InspectionData | null>(null);
  const [ro, setRo] = useState<RepairOrder | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [sharedAt, setSharedAt] = useState<string>("");
  const [message, setMessage] = useState("Loading inspection…");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") || "";
    if (!token) {
      setMessage("This inspection link is invalid.");
      return;
    }
    fetch(`/.netlify/functions/inspection-report?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        const body = await response.json() as {
          inspection?: { data: unknown; sharedAt: string; repairOrder: RepairOrder };
          business?: Business;
          error?: string;
        };
        if (!response.ok || !body.inspection) throw new Error(body.error || "Inspection not found.");
        setData(normalizeInspection(body.inspection.data));
        setRo(body.inspection.repairOrder);
        setSharedAt(body.inspection.sharedAt);
        setBusiness(body.business || null);
        setMessage("");
      })
      .catch((error: Error) => setMessage(error.message));
  }, []);

  useEffect(() => {
    if (!business) return;
    const root = document.documentElement;
    if (business.primaryColor) root.style.setProperty("--blue", business.primaryColor);
    if (business.accentColor) root.style.setProperty("--red", business.accentColor);
  }, [business]);

  if (!data || !ro || !business) {
    return (
      <main className="approval-shell">
        <article className="approval-card" style={{ maxWidth: 520, textAlign: "center" }}>
          <div className="notice">{message}</div>
        </article>
      </main>
    );
  }

  const customer = ro.customers;
  const vehicle = ro.vehicles;
  const vehicleLabel = [vehicle?.year, vehicle?.make, vehicle?.model, vehicle?.trim].filter(Boolean).join(" ");
  const attentionCount = Object.values(data.items).filter((item) => item.status === "monitor" || item.status === "service").length;

  return (
    <main className="approval-shell">
      <article className="approval-card document-page">
        <header className="document-header">
          <div>
            {business.logoUrl ? (
              <img className="document-logo" src={business.logoUrl} alt={business.name} />
            ) : (
              <h2 className="document-logo-text">{business.name}</h2>
            )}
            {business.address && <p>{business.address}</p>}
            <p>{[business.phone, business.email].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="document-title">
            <h2>Inspection Report</h2>
            <p className="document-subtitle">Multipoint vehicle inspection</p>
            <strong>RO #{String(ro.ro_number).padStart(4, "0")}</strong>
            <span>{sharedAt ? new Date(sharedAt).toLocaleDateString() : ""}</span>
          </div>
        </header>

        <section className="document-stage-banner">
          <div>
            <span className="stage-eyebrow">Summary</span>
            <strong>{attentionCount === 0 ? "Everything checked out" : `${attentionCount} item${attentionCount === 1 ? "" : "s"} need attention`}</strong>
            <small>{attentionCount === 0 ? "No items were flagged for monitoring or service." : "See Monitor / Service items below for details."}</small>
          </div>
        </section>

        <div className="document-info-grid">
          <section><h3>Customer</h3><strong>{customer?.name || "—"}</strong></section>
          <section><h3>Vehicle</h3><strong>{vehicleLabel || "—"}</strong><span>VIN: {vehicle?.vin || "—"}</span></section>
          <section><h3>Mileage</h3><strong>{ro.mileage_in?.toLocaleString() || "—"}</strong></section>
        </div>

        {data.technician && (
          <p className="document-subtitle" style={{ marginLeft: 0, textAlign: "left" }}>
            Inspected by {data.technician}
          </p>
        )}

        {sections.map((section) => (
          <div key={section.key}>
            <div className="document-section-heading">
              <h3>{section.title}</h3>
            </div>
            <table className="document-table">
              <thead>
                <tr><th>Item</th><th>Measurement</th><th>Status</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {section.items.map((item) => {
                  const key = `${section.key}_${item.id}`;
                  const value = data.items[key] ?? blankValue();
                  return (
                    <tr key={key}>
                      <td>{item.label}</td>
                      <td>
                        {[item.measurement1 && value.measurement1, item.measurement2 && value.measurement2]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td><span className={`inspection-report-status ${value.status || "na"}`}>{statusLabel(value.status)}</span></td>
                      <td>{value.notes || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

        {data.recommendations && (
          <section className="concern-box">
            <h3>Technician recommendations</h3>
            <p>{data.recommendations}</p>
          </section>
        )}

        <footer className="document-footer">
          <p>This report reflects the condition of your vehicle at the time of inspection. Contact {business.name} with any questions about the items above.</p>
        </footer>
      </article>
    </main>
  );
}
