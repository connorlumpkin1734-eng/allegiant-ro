"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Status = "" | "good" | "monitor" | "service" | "na";
type InspectionValue = {
  status: Status;
  measurement1: string;
  measurement2: string;
  notes: string;
};
type InspectionData = {
  technician: string;
  transmission: "" | "automatic" | "manual";
  page1Notes: string;
  recommendations: string;
  initials: [string, string, string];
  items: Record<string, InspectionValue>;
};
type InspectionRo = {
  id: string;
  ro_number: number;
  mileage_in: number | null;
  customers?: { name: string; phone: string | null; email: string | null } | null;
  vehicles?: {
    year: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
    vin: string | null;
    license_plate: string | null;
    plate_state: string | null;
  } | null;
};
type InspectionItem = {
  id: string;
  label: string;
  measurement1?: string;
  measurement2?: string;
};
type InspectionSection = {
  key: string;
  title: string;
  items: InspectionItem[];
};

const sections: InspectionSection[] = [
  {
    key: "tires",
    title: "Tires & Wheels",
    items: [
      { id: "1", label: "LF", measurement1: "Tread /32", measurement2: "PSI" },
      { id: "2", label: "RF", measurement1: "Tread /32", measurement2: "PSI" },
      { id: "3", label: "LR", measurement1: "Tread /32", measurement2: "PSI" },
      { id: "4", label: "RR", measurement1: "Tread /32", measurement2: "PSI" },
      { id: "5", label: "Spare / tire repair kit" },
    ],
  },
  {
    key: "brakes",
    title: "Brake System",
    items: [
      { id: "1", label: "LF", measurement1: "Pad/Shoe mm", measurement2: "Rotor/Drum" },
      { id: "2", label: "RF", measurement1: "Pad/Shoe mm", measurement2: "Rotor/Drum" },
      { id: "3", label: "LR", measurement1: "Pad/Shoe mm", measurement2: "Rotor/Drum" },
      { id: "4", label: "RR", measurement1: "Pad/Shoe mm", measurement2: "Rotor/Drum" },
      { id: "5", label: "Brake fluid level / condition" },
      { id: "6", label: "Parking brake operation" },
      { id: "7", label: "Brake hoses / lines visible condition" },
    ],
  },
  {
    key: "underhood",
    title: "Under Hood",
    items: [
      "Engine oil level / condition",
      "Coolant level / condition",
      "Transmission fluid / leaks",
      "Clutch fluid level / leaks (if equipped)",
      "Power steering fluid / system",
      "Belts / tensioner / pulleys",
      "Cooling / heater hoses",
      "Battery / terminals / hold-down",
      "Engine air filter",
      "Cabin air filter",
      "Washer fluid / reservoir",
      "Visible engine / coolant / fluid leaks",
    ].map((label, index) => ({ id: String(index + 1), label })),
  },
  {
    key: "steering",
    title: "Steering & Suspension",
    items: [
      "Steering linkage / rack / steering gear",
      "Tie rods / steering joints",
      "Ball joints / control arms / bushings",
      "Shocks / struts",
      "Springs / ride height",
      "Wheel bearings / hubs",
      "Alignment / abnormal tire wear indicators",
    ].map((label, index) => ({ id: String(index + 1), label })),
  },
  {
    key: "driveline",
    title: "Under Vehicle & Driveline",
    items: [
      "CV axles / boots / U-joints",
      "Drive shaft / center support",
      "Differential / transfer case leaks",
      "Transmission / oil pan / engine lower leaks",
      "Clutch linkage / cable / hydraulics (if equipped)",
      "Exhaust system / catalytic converters / hangers",
      "Fuel lines / tank visible condition",
      "Frame / crossmembers / underbody",
    ].map((label, index) => ({ id: String(index + 1), label })),
  },
  {
    key: "electrical",
    title: "Electrical, Exterior & Safety",
    items: [
      "Headlamps / high beams",
      "Brake / tail / marker lamps",
      "Turn signals / hazards",
      "Wipers / washers",
      "Horn",
      "Mirrors / windshield / glass",
      "Seat belts / warning lamps",
      "HVAC / A/C / heater / cabin blower",
      "Battery charging / starting system",
      "Instrument cluster warning lights",
    ].map((label, index) => ({ id: String(index + 1), label })),
  },
  {
    key: "roadtest",
    title: "Road Test",
    items: [
      "Engine performance / idle / acceleration",
      "Automatic transmission operation / shift quality",
      "Manual transmission shift quality / synchros (if equipped)",
      "Clutch pedal / engagement / slip / chatter (if equipped)",
      "Steering / tracking / steering wheel center",
      "Brake operation / pedal feel / pull",
      "Noise / vibration / harshness",
      "Cruise / driver-assistance systems (if equipped)",
    ].map((label, index) => ({ id: String(index + 1), label })),
  },
];

const blankValue = (): InspectionValue => ({ status: "good", measurement1: "", measurement2: "", notes: "" });

function blankInspection(): InspectionData {
  const items: Record<string, InspectionValue> = {};
  for (const section of sections) {
    for (const item of section.items) items[`${section.key}_${item.id}`] = blankValue();
  }
  return { technician: "", transmission: "", page1Notes: "", recommendations: "", initials: ["", "", ""], items };
}

function normalizeInspection(value: unknown): InspectionData {
  const blank = blankInspection();
  if (!value || typeof value !== "object") return blank;
  const candidate = value as Partial<InspectionData>;
  return {
    ...blank,
    ...candidate,
    initials: Array.isArray(candidate.initials)
      ? [String(candidate.initials[0] ?? ""), String(candidate.initials[1] ?? ""), String(candidate.initials[2] ?? "")]
      : blank.initials,
    items: { ...blank.items, ...(candidate.items ?? {}) },
  };
}

const statusOptions: { value: Exclude<Status, "">; label: string }[] = [
  { value: "good", label: "Good" },
  { value: "monitor", label: "Monitor" },
  { value: "service", label: "Service" },
  { value: "na", label: "N/A" },
];

export function MultipointInspection({
  ro,
  userId,
  onBack,
}: {
  ro: InspectionRo;
  userId: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<InspectionData>(blankInspection);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const customer = ro.customers;
  const vehicle = ro.vehicles;

  useEffect(() => {
    let active = true;
    async function loadInspection() {
      const { data: existing, error } = await supabase
        .from("multipoint_inspections")
        .select("data, updated_at")
        .eq("repair_order_id", ro.id)
        .maybeSingle();
      if (!active) return;
      if (error) {
        setMessage(error.message.includes("multipoint_inspections")
          ? "Inspection database setup is required before this can be saved."
          : error.message);
      } else if (existing) {
        setData(normalizeInspection(existing.data));
        setSavedAt(existing.updated_at ?? "");
      }
      setLoading(false);
    }
    void loadInspection();
    return () => { active = false; };
  }, [ro.id]);

  const completedCount = useMemo(
    () => Object.values(data.items).filter((item) => item.status).length,
    [data.items]
  );
  const totalCount = Object.keys(data.items).length;

  function changeItem(key: string, changes: Partial<InspectionValue>) {
    setData((current) => ({
      ...current,
      items: {
        ...current.items,
        [key]: { ...(current.items[key] ?? blankValue()), ...changes },
      },
    }));
    setMessage("");
  }

  async function saveInspection() {
    setSaving(true);
    setMessage("");
    const now = new Date().toISOString();
    const { error } = await supabase.from("multipoint_inspections").upsert(
      {
        owner_id: userId,
        repair_order_id: ro.id,
        data,
        updated_at: now,
      },
      { onConflict: "repair_order_id" }
    );
    if (error) {
      setMessage(error.message);
    } else {
      setSavedAt(now);
      setMessage("Inspection saved to this repair order.");
    }
    setSaving(false);
  }

  async function exportPdf() {
    setExporting(true);
    setMessage("");
    try {
      const { PDFDocument, StandardFonts } = await import("pdf-lib");
      const response = await fetch("/multipoint-inspection-template.pdf");
      if (!response.ok) throw new Error("The inspection PDF template could not be loaded.");
      const pdf = await PDFDocument.load(await response.arrayBuffer());
      const form = pdf.getForm();
      const date = new Date().toLocaleDateString("en-US");
      const roNumber = String(ro.ro_number).padStart(4, "0");
      const textValues: Record<string, string> = {
        customer: customer?.name ?? "",
        ro_number: roNumber,
        date,
        phone: customer?.phone ?? "",
        email: customer?.email ?? "",
        year: vehicle?.year?.toString() ?? "",
        make: vehicle?.make ?? "",
        model: [vehicle?.model, vehicle?.trim].filter(Boolean).join(" "),
        mileage: ro.mileage_in?.toLocaleString("en-US") ?? "",
        vin: vehicle?.vin ?? "",
        plate: [vehicle?.license_plate, vehicle?.plate_state].filter(Boolean).join(" "),
        technician: data.technician,
        page1_notes: data.page1Notes,
        page1_initials: data.initials[0],
        page2_initials: data.initials[1],
        page3_initials: data.initials[2],
        final_recommendations: data.recommendations,
        final_technician: data.technician,
        final_date: date,
        final_ro_number: roNumber,
      };
      for (const [name, value] of Object.entries(textValues)) form.getTextField(name).setText(value);
      if (data.transmission) form.getCheckBox(`trans_${data.transmission === "automatic" ? "auto" : "manual"}`).check();

      for (const section of sections) {
        for (const item of section.items) {
          const value = data.items[`${section.key}_${item.id}`] ?? blankValue();
          if (item.measurement1) form.getTextField(`${section.key}_measure1_${item.id}`).setText(value.measurement1);
          if (item.measurement2) form.getTextField(`${section.key}_measure2_${item.id}`).setText(value.measurement2);
          form.getTextField(`${section.key}_notes_${item.id}`).setText(value.notes);
          if (value.status) form.getCheckBox(`${section.key}_${value.status}_${item.id}`).check();
        }
      }
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      form.updateFieldAppearances(font);
      const bytes = await pdf.save();
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `Allegiant_Multipoint_Inspection_RO_${roNumber}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not export the inspection PDF.");
    }
    setExporting(false);
  }

  if (loading) return <div className="panel">Loading inspection…</div>;

  return (
    <section className="inspection-shell">
      <div className="inspection-toolbar">
        <div>
          <button className="back-link" onClick={onBack}>← Back to RO</button>
          <h1>Multipoint Inspection - RO #{String(ro.ro_number).padStart(4, "0")}</h1>
          <p>{customer?.name} · {[vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ")}</p>
        </div>
        <div className="button-row">
          <span className="inspection-progress">{completedCount}/{totalCount} checked</span>
          <button className="button secondary" onClick={exportPdf} disabled={exporting}>
            {exporting ? "Creating PDF…" : "Export PDF"}
          </button>
          <button className="button primary" onClick={saveInspection} disabled={saving}>
            {saving ? "Saving…" : "Save Inspection"}
          </button>
        </div>
      </div>

      {message && <div className={message.includes("saved") ? "notice" : "error-banner"}>{message}</div>}
      {savedAt && <p className="inspection-saved">Last saved {new Date(savedAt).toLocaleString()}</p>}

      <section className="panel inspection-vehicle-card">
        <div><span>Customer</span><strong>{customer?.name || "—"}</strong></div>
        <div><span>Vehicle</span><strong>{[vehicle?.year, vehicle?.make, vehicle?.model, vehicle?.trim].filter(Boolean).join(" ") || "—"}</strong></div>
        <div><span>VIN</span><strong>{vehicle?.vin || "—"}</strong></div>
        <div><span>Mileage</span><strong>{ro.mileage_in?.toLocaleString() || "—"}</strong></div>
        <label>
          Technician
          <input value={data.technician} onChange={(event) => setData({ ...data, technician: event.target.value })} />
        </label>
        <label>
          Transmission
          <select value={data.transmission} onChange={(event) => setData({ ...data, transmission: event.target.value as InspectionData["transmission"] })}>
            <option value="">Select…</option>
            <option value="automatic">Automatic</option>
            <option value="manual">Manual</option>
          </select>
        </label>
      </section>

      {sections.map((section) => (
        <section className="panel inspection-section" key={section.key}>
          <h2>{section.title}</h2>
          <div className="inspection-table-wrap">
            <table className="inspection-table">
              <thead>
                <tr>
                  <th>Inspection item</th>
                  <th>Measurement</th>
                  <th>Status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {section.items.map((item) => {
                  const key = `${section.key}_${item.id}`;
                  const value = data.items[key] ?? blankValue();
                  return (
                    <tr key={key}>
                      <td className="inspection-item-label">{item.label}</td>
                      <td>
                        {(item.measurement1 || item.measurement2) ? (
                          <div className="inspection-measurements">
                            {item.measurement1 && <input aria-label={item.measurement1} placeholder={item.measurement1} value={value.measurement1} onChange={(event) => changeItem(key, { measurement1: event.target.value })} />}
                            {item.measurement2 && <input aria-label={item.measurement2} placeholder={item.measurement2} value={value.measurement2} onChange={(event) => changeItem(key, { measurement2: event.target.value })} />}
                          </div>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td>
                        <div className="inspection-statuses">
                          {statusOptions.map((option) => (
                            <button
                              type="button"
                              key={option.value}
                              className={`inspection-status ${option.value} ${value.status === option.value ? "selected" : ""}`}
                              onClick={() => changeItem(key, { status: value.status === option.value ? "" : option.value })}
                            >
                              <span aria-hidden="true" />
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td><input placeholder="Notes" value={value.notes} onChange={(event) => changeItem(key, { notes: event.target.value })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {section.key === "brakes" && (
            <label className="inspection-wide-notes">
              Page 1 notes
              <textarea rows={3} value={data.page1Notes} onChange={(event) => setData({ ...data, page1Notes: event.target.value })} />
            </label>
          )}
        </section>
      ))}

      <section className="panel inspection-final">
        <h2>Final Findings & Recommendations</h2>
        <textarea rows={6} value={data.recommendations} onChange={(event) => setData({ ...data, recommendations: event.target.value })} />
        <div className="inspection-initials">
          {[0, 1, 2].map((index) => (
            <label key={index}>
              Page {index + 1} initials
              <input value={data.initials[index]} onChange={(event) => {
                const initials: [string, string, string] = [...data.initials];
                initials[index] = event.target.value;
                setData({ ...data, initials });
              }} />
            </label>
          ))}
        </div>
      </section>

      <div className="inspection-bottom-actions">
        <button className="button secondary" onClick={onBack}>Back to RO</button>
        <button className="button secondary" onClick={exportPdf} disabled={exporting}>Export PDF</button>
        <button className="button primary" onClick={saveInspection} disabled={saving}>{saving ? "Saving…" : "Save Inspection"}</button>
      </div>
    </section>
  );
}
