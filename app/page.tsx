"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type View = "dashboard" | "editor" | "customers" | "settings" | "document";
type DocumentType = "estimate" | "repair_order" | "invoice";
type ItemType = "labor" | "part" | "fee" | "discount";

type Settings = {
  id?: string;
  owner_id?: string;
  business_name: string;
  business_address: string;
  business_phone: string;
  business_email: string;
  default_labor_rate: number;
  default_parts_markup: number;
  sales_tax_rate: number;
  invoice_footer: string;
};

type Customer = {
  id: string;
  name: string;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
};

type Vehicle = {
  id: string;
  customer_id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  engine: string | null;
  vin: string | null;
  license_plate: string | null;
  plate_state: string | null;
  color: string | null;
  notes: string | null;
  vin_data?: Record<string, unknown> | null;
};

type LineItem = {
  id: string;
  item_type: ItemType;
  description: string;
  quantity: number;
  unit_cost: number | null;
  markup_percent: number | null;
  unit_price: number;
  taxable: boolean;
  sort_order: number;
};

type RepairOrder = {
  id: string;
  ro_number: number;
  customer_id: string;
  vehicle_id: string;
  document_type: DocumentType;
  status: "open" | "completed" | "voided";
  mileage_in: number | null;
  mileage_out: number | null;
  customer_concern: string | null;
  notes: string | null;
  paid: boolean;
  paid_at: string | null;
  tax_rate: number;
  created_at: string;
  updated_at: string;
  customers?: Customer | null;
  vehicles?: Vehicle | null;
  line_items?: LineItem[];
};

type CustomerForm = {
  name: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  zip_code: string;
  phone: string;
  email: string;
  notes: string;
};

type VehicleForm = {
  year: string;
  make: string;
  model: string;
  trim: string;
  engine: string;
  vin: string;
  license_plate: string;
  plate_state: string;
  color: string;
  notes: string;
  vin_data: Record<string, unknown> | null;
};

const defaultSettings: Settings = {
  business_name: "Allegiant Auto Care",
  business_address: "",
  business_phone: "",
  business_email: "",
  default_labor_rate: 100,
  default_parts_markup: 15,
  sales_tax_rate: 0,
  invoice_footer:
    "Thank you for choosing Allegiant Auto Care. Payment is due upon completion of services. Warranty coverage, when applicable, will be stated on the final invoice. Please retain this document for your records.",
};

const blankCustomer: CustomerForm = {
  name: "",
  address_line_1: "",
  address_line_2: "",
  city: "",
  state: "TX",
  zip_code: "",
  phone: "",
  email: "",
  notes: "",
};

const blankVehicle: VehicleForm = {
  year: "",
  make: "",
  model: "",
  trim: "",
  engine: "",
  vin: "",
  license_plate: "",
  plate_state: "TX",
  color: "",
  notes: "",
  vin_data: null,
};

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number.isFinite(value) ? value : 0);
}

function padRo(value: number | string | null | undefined): string {
  return String(value ?? "").padStart(4, "0");
}

function labelDocument(type: DocumentType): string {
  if (type === "repair_order") return "Repair Order";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function valueOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyLine(type: ItemType, settings: Settings, index: number): LineItem {
  if (type === "labor") {
    return {
      id: crypto.randomUUID(),
      item_type: type,
      description: "",
      quantity: 1,
      unit_cost: null,
      markup_percent: null,
      unit_price: settings.default_labor_rate,
      taxable: false,
      sort_order: index,
    };
  }

  if (type === "part") {
    return {
      id: crypto.randomUUID(),
      item_type: type,
      description: "",
      quantity: 1,
      unit_cost: 0,
      markup_percent: settings.default_parts_markup,
      unit_price: 0,
      taxable: true,
      sort_order: index,
    };
  }

  return {
    id: crypto.randomUUID(),
    item_type: type,
    description: type === "fee" ? "Shop supplies" : "Discount",
    quantity: 1,
    unit_cost: null,
    markup_percent: null,
    unit_price: 0,
    taxable: type === "fee",
    sort_order: index,
  };
}

export default function HomePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

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

  if (authLoading) {
    return <div className="center-screen">Loading Allegiant RO…</div>;
  }

  if (!session) {
    return <AuthScreen />;
  }

  return <RepairOrderApp user={session.user} />;
}

function AuthScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    const result =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    if (result.error) {
      setMessage(result.error.message);
    } else if (mode === "signup" && !result.data.session) {
      setMessage("Account created. Check your email to confirm it, then sign in.");
    }

    setBusy(false);
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <img
  className="login-logo"
  src="/allegiant-auto-care-logo.png"
  alt="Allegiant Auto Care"
/>
        <p className="muted">Repair orders, estimates, and invoices.</p>
        <form onSubmit={submit} className="stack">
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={6}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>
          {message && <div className="notice">{message}</div>}
          <button className="button primary" disabled={busy} type="submit">
            {busy ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
        <button
          className="button link-button"
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setMessage("");
          }}
        >
          {mode === "login" ? "Create the first account" : "Back to sign in"}
        </button>
      </section>
    </main>
  );
}

function RepairOrderApp({ user }: { user: User }) {
  const [view, setView] = useState<View>("dashboard");
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [repairOrders, setRepairOrders] = useState<RepairOrder[]>([]);
  const [selectedRo, setSelectedRo] = useState<RepairOrder | null>(null);
  const [editingRo, setEditingRo] = useState<RepairOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadData() {
    setLoading(true);
    setError("");

    const [settingsResult, customersResult, vehiclesResult, roResult] = await Promise.all([
      supabase.from("settings").select("*").maybeSingle(),
      supabase.from("customers").select("*").order("name"),
      supabase.from("vehicles").select("*").order("year", { ascending: false }),
      supabase
        .from("repair_orders")
        .select("*, customers(*), vehicles(*)")
        .order("created_at", { ascending: false }),
    ]);

    const firstError =
      settingsResult.error || customersResult.error || vehiclesResult.error || roResult.error;

    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    let loadedSettings = settingsResult.data as Settings | null;
    if (!loadedSettings) {
      const { data, error: insertError } = await supabase
        .from("settings")
        .insert({ ...defaultSettings, owner_id: user.id })
        .select()
        .single();
      if (insertError) {
        setError(insertError.message);
      } else {
        loadedSettings = data as Settings;
      }
    }

    setSettings(loadedSettings ?? defaultSettings);
    setCustomers((customersResult.data ?? []) as Customer[]);
    setVehicles((vehiclesResult.data ?? []) as Vehicle[]);
    setRepairOrders((roResult.data ?? []) as RepairOrder[]);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openDocument(id: string) {
    setError("");
    const { data, error: fetchError } = await supabase
      .from("repair_orders")
      .select("*, customers(*), vehicles(*), line_items(*)")
      .eq("id", id)
      .single();

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    const loaded = data as RepairOrder;
    loaded.line_items = [...(loaded.line_items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    setSelectedRo(loaded);
    setView("document");
  }

  async function editDocument(id: string) {
    setError("");
    const { data, error: fetchError } = await supabase
      .from("repair_orders")
      .select("*, customers(*), vehicles(*), line_items(*)")
      .eq("id", id)
      .single();

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    const loaded = data as RepairOrder;
    loaded.line_items = [...(loaded.line_items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    setEditingRo(loaded);
    setView("editor");
  }

  function startNew() {
    setEditingRo(null);
    setView("editor");
  }

  return (
    <div className="app-shell">
      <header className="topbar no-print">
        <button className="brand-button" type="button" onClick={() => setView("dashboard")}>
          <img
  className="topbar-logo"
  src="/allegiant-auto-care-logo.png"
  alt="Allegiant Auto Care"
/>
        </button>
        <nav>
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>
            Dashboard
          </button>
          <button onClick={startNew}>New RO</button>
          <button className={view === "customers" ? "active" : ""} onClick={() => setView("customers")}>
            Customers
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
            Settings
          </button>
        </nav>
        <button className="button secondary" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </header>

      <main className="main-area">
        {error && <div className="error-banner no-print">{error}</div>}
        {loading ? (
          <div className="panel">Loading shop data…</div>
        ) : view === "dashboard" ? (
          <Dashboard repairOrders={repairOrders} onNew={startNew} onOpen={openDocument} onEdit={editDocument} />
        ) : view === "editor" ? (
          <RepairOrderEditor
            user={user}
            settings={settings}
            customers={customers}
            vehicles={vehicles}
            initialRo={editingRo}
            onCancel={() => setView("dashboard")}
            onSaved={async (id) => {
              await loadData();
              await openDocument(id);
            }}
          />
        ) : view === "customers" ? (
          <CustomerDirectory customers={customers} vehicles={vehicles} repairOrders={repairOrders} />
        ) : view === "settings" ? (
          <SettingsPanel
            user={user}
            initialSettings={settings}
            onSaved={async () => {
              await loadData();
              setView("dashboard");
            }}
          />
        ) : selectedRo ? (
          <DocumentView
            ro={selectedRo}
            settings={settings}
            onBack={() => setView("dashboard")}
            onEdit={() => editDocument(selectedRo.id)}
          />
        ) : null}
      </main>
    </div>
  );
}

function Dashboard({
  repairOrders,
  onNew,
  onOpen,
  onEdit,
}: {
  repairOrders: RepairOrder[];
  onNew: () => void;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const normalized = search.toLowerCase().trim();

  const filtered = repairOrders.filter((ro) => {
    if (!normalized) return true;
    const customer = ro.customers;
    const vehicle = ro.vehicles;
    const haystack = [
      padRo(ro.ro_number),
      customer?.name,
      customer?.phone,
      customer?.email,
      vehicle?.year,
      vehicle?.make,
      vehicle?.model,
      vehicle?.vin,
      vehicle?.license_plate,
      ro.customer_concern,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalized);
  });

  const openCount = repairOrders.filter((ro) => ro.status === "open").length;
  const unpaidCount = repairOrders.filter((ro) => !ro.paid && ro.document_type === "invoice").length;

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Repair Orders</h1>
          <p>One RO number from estimate through invoice.</p>
        </div>
        <button className="button primary" onClick={onNew}>
          + New RO
        </button>
      </div>

      <div className="summary-grid">
        <div className="summary-card">
          <span>Total records</span>
          <strong>{repairOrders.length}</strong>
        </div>
        <div className="summary-card">
          <span>Open</span>
          <strong>{openCount}</strong>
        </div>
        <div className="summary-card">
          <span>Unpaid invoices</span>
          <strong>{unpaidCount}</strong>
        </div>
      </div>

      <div className="panel">
        <div className="toolbar">
          <input
            className="search-input"
            placeholder="Search customer, phone, VIN, plate, RO, vehicle…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>RO</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Vehicle</th>
                <th>Document</th>
                <th>Payment</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ro) => (
                <tr key={ro.id}>
                  <td className="ro-number">#{padRo(ro.ro_number)}</td>
                  <td>{new Date(ro.created_at).toLocaleDateString()}</td>
                  <td>{ro.customers?.name || "—"}</td>
                  <td>
                    {[ro.vehicles?.year, ro.vehicles?.make, ro.vehicles?.model].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td>{labelDocument(ro.document_type)}</td>
                  <td>
                    <span className={`badge ${ro.paid ? "paid" : "unpaid"}`}>
                      {ro.paid ? "Paid" : "Unpaid"}
                    </span>
                  </td>
                  <td className="actions-cell">
                    <button className="button small secondary" onClick={() => onOpen(ro.id)}>
                      Open
                    </button>
                    <button className="button small ghost" onClick={() => onEdit(ro.id)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={7} className="empty-state">
                    No matching repair orders.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function RepairOrderEditor({
  user,
  settings,
  customers,
  vehicles,
  initialRo,
  onCancel,
  onSaved,
}: {
  user: User;
  settings: Settings;
  customers: Customer[];
  vehicles: Vehicle[];
  initialRo: RepairOrder | null;
  onCancel: () => void;
  onSaved: (id: string) => void;
}) {
  const [selectedCustomerId, setSelectedCustomerId] = useState(initialRo?.customer_id ?? "");
  const [selectedVehicleId, setSelectedVehicleId] = useState(initialRo?.vehicle_id ?? "");
  const [customerForm, setCustomerForm] = useState<CustomerForm>(() => {
    const customer = initialRo?.customers;
    return customer
      ? {
          name: customer.name ?? "",
          address_line_1: customer.address_line_1 ?? "",
          address_line_2: customer.address_line_2 ?? "",
          city: customer.city ?? "",
          state: customer.state ?? "TX",
          zip_code: customer.zip_code ?? "",
          phone: customer.phone ?? "",
          email: customer.email ?? "",
          notes: customer.notes ?? "",
        }
      : blankCustomer;
  });
  const [vehicleForm, setVehicleForm] = useState<VehicleForm>(() => {
    const vehicle = initialRo?.vehicles;
    return vehicle
      ? {
          year: vehicle.year?.toString() ?? "",
          make: vehicle.make ?? "",
          model: vehicle.model ?? "",
          trim: vehicle.trim ?? "",
          engine: vehicle.engine ?? "",
          vin: vehicle.vin ?? "",
          license_plate: vehicle.license_plate ?? "",
          plate_state: vehicle.plate_state ?? "TX",
          color: vehicle.color ?? "",
          notes: vehicle.notes ?? "",
          vin_data: vehicle.vin_data ?? null,
        }
      : blankVehicle;
  });
  const [documentType, setDocumentType] = useState<DocumentType>(initialRo?.document_type ?? "estimate");
  const [status, setStatus] = useState<"open" | "completed" | "voided">(initialRo?.status ?? "open");
  const [mileageIn, setMileageIn] = useState(initialRo?.mileage_in?.toString() ?? "");
  const [mileageOut, setMileageOut] = useState(initialRo?.mileage_out?.toString() ?? "");
  const [concern, setConcern] = useState(initialRo?.customer_concern ?? "");
  const [notes, setNotes] = useState(initialRo?.notes ?? "");
  const [paid, setPaid] = useState(initialRo?.paid ?? false);
  const [taxRate, setTaxRate] = useState(Number(initialRo?.tax_rate ?? settings.sales_tax_rate));
  const [items, setItems] = useState<LineItem[]>(() =>
    initialRo?.line_items?.length
      ? initialRo.line_items.map((item, index) => ({ ...item, sort_order: index }))
      : [emptyLine("labor", settings, 0)]
  );
  const [busy, setBusy] = useState(false);
  const [vinBusy, setVinBusy] = useState(false);
  const [message, setMessage] = useState("");

  const customerVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.customer_id === selectedCustomerId),
    [vehicles, selectedCustomerId]
  );

  const totals = useMemo(() => {
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
    const taxableSubtotal = items.reduce(
      (sum, item) => sum + (item.taxable ? item.quantity * item.unit_price : 0),
      0
    );
    const tax = Math.max(0, taxableSubtotal) * (taxRate / 100);
    return { subtotal, taxableSubtotal, tax, total: subtotal + tax };
  }, [items, taxRate]);

  function chooseCustomer(id: string) {
    setSelectedCustomerId(id);
    setSelectedVehicleId("");
    setVehicleForm(blankVehicle);

    if (!id) {
      setCustomerForm(blankCustomer);
      return;
    }

    const customer = customers.find((entry) => entry.id === id);
    if (!customer) return;
    setCustomerForm({
      name: customer.name ?? "",
      address_line_1: customer.address_line_1 ?? "",
      address_line_2: customer.address_line_2 ?? "",
      city: customer.city ?? "",
      state: customer.state ?? "TX",
      zip_code: customer.zip_code ?? "",
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      notes: customer.notes ?? "",
    });
  }

  function chooseVehicle(id: string) {
    setSelectedVehicleId(id);
    if (!id) {
      setVehicleForm(blankVehicle);
      return;
    }

    const vehicle = vehicles.find((entry) => entry.id === id);
    if (!vehicle) return;
    setVehicleForm({
      year: vehicle.year?.toString() ?? "",
      make: vehicle.make ?? "",
      model: vehicle.model ?? "",
      trim: vehicle.trim ?? "",
      engine: vehicle.engine ?? "",
      vin: vehicle.vin ?? "",
      license_plate: vehicle.license_plate ?? "",
      plate_state: vehicle.plate_state ?? "TX",
      color: vehicle.color ?? "",
      notes: vehicle.notes ?? "",
      vin_data: vehicle.vin_data ?? null,
    });
  }

  function addItem(type: ItemType) {
    setItems((current) => [...current, emptyLine(type, settings, current.length)]);
  }

  function changeItem(id: string, field: keyof LineItem, rawValue: string | boolean | number) {
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item };

        if (field === "item_type") {
          return emptyLine(rawValue as ItemType, settings, item.sort_order);
        }

        if (field === "description") next.description = String(rawValue);
        if (field === "taxable") next.taxable = Boolean(rawValue);
        if (field === "quantity") next.quantity = Number(rawValue) || 0;
        if (field === "unit_cost") next.unit_cost = Number(rawValue) || 0;
        if (field === "markup_percent") next.markup_percent = Number(rawValue) || 0;
        if (field === "unit_price") {
          const entered = Number(rawValue) || 0;
          next.unit_price = next.item_type === "discount" ? -Math.abs(entered) : entered;
        }

        if (next.item_type === "part") {
          const cost = Number(next.unit_cost || 0);
          if (field === "unit_cost" || field === "markup_percent") {
            next.unit_price = cost * (1 + Number(next.markup_percent || 0) / 100);
          }
          if (field === "unit_price" && cost > 0) {
            next.markup_percent = (next.unit_price / cost - 1) * 100;
          }
        }

        return next;
      })
    );
  }

  async function decodeVin() {
    const vin = vehicleForm.vin.trim().toUpperCase();
    if (vin.length < 8) {
      setMessage("Enter a VIN before decoding.");
      return;
    }

    setVinBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(vin)}?format=json`
      );
      if (!response.ok) throw new Error("VIN decoder did not respond.");
      const body = (await response.json()) as { Results?: Array<Record<string, string>> };
      const decoded = body.Results?.[0];
      if (!decoded) throw new Error("No VIN result was returned.");

      const engineParts = [
        decoded.DisplacementL ? `${decoded.DisplacementL}L` : "",
        decoded.EngineCylinders ? `${decoded.EngineCylinders} cyl` : "",
        decoded.EngineModel || "",
      ].filter(Boolean);

      setVehicleForm((current) => ({
        ...current,
        vin,
        year: decoded.ModelYear || current.year,
        make: decoded.Make || current.make,
        model: decoded.Model || current.model,
        trim: decoded.Trim || decoded.Series || current.trim,
        engine: engineParts.join(" ") || current.engine,
        vin_data: decoded,
      }));
      setMessage("VIN decoded. Review the fields before saving.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "VIN decoding failed.");
    } finally {
      setVinBusy(false);
    }
  }

  async function save() {
    if (!customerForm.name.trim()) {
      setMessage("Customer name is required.");
      return;
    }
    if (!vehicleForm.year.trim() && !vehicleForm.make.trim() && !vehicleForm.model.trim()) {
      setMessage("Enter at least the vehicle year, make, or model.");
      return;
    }
    if (!items.length || items.some((item) => !item.description.trim())) {
      setMessage("Every line item needs a description.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const customerPayload = {
        owner_id: user.id,
        name: customerForm.name.trim(),
        address_line_1: valueOrNull(customerForm.address_line_1),
        address_line_2: valueOrNull(customerForm.address_line_2),
        city: valueOrNull(customerForm.city),
        state: valueOrNull(customerForm.state),
        zip_code: valueOrNull(customerForm.zip_code),
        phone: valueOrNull(customerForm.phone),
        email: valueOrNull(customerForm.email),
        notes: valueOrNull(customerForm.notes),
      };

      let customerId = selectedCustomerId;
      if (customerId) {
        const { error } = await supabase.from("customers").update(customerPayload).eq("id", customerId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("customers").insert(customerPayload).select("id").single();
        if (error) throw error;
        customerId = data.id as string;
      }

      const vehiclePayload = {
        owner_id: user.id,
        customer_id: customerId,
        year: numberOrNull(vehicleForm.year),
        make: valueOrNull(vehicleForm.make),
        model: valueOrNull(vehicleForm.model),
        trim: valueOrNull(vehicleForm.trim),
        engine: valueOrNull(vehicleForm.engine),
        vin: valueOrNull(vehicleForm.vin.toUpperCase()),
        license_plate: valueOrNull(vehicleForm.license_plate.toUpperCase()),
        plate_state: valueOrNull(vehicleForm.plate_state.toUpperCase()),
        color: valueOrNull(vehicleForm.color),
        notes: valueOrNull(vehicleForm.notes),
        vin_data: vehicleForm.vin_data,
      };

      let vehicleId = selectedVehicleId;
      if (vehicleId) {
        const { error } = await supabase.from("vehicles").update(vehiclePayload).eq("id", vehicleId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("vehicles").insert(vehiclePayload).select("id").single();
        if (error) throw error;
        vehicleId = data.id as string;
      }

      const roPayload = {
        owner_id: user.id,
        customer_id: customerId,
        vehicle_id: vehicleId,
        document_type: documentType,
        status,
        mileage_in: numberOrNull(mileageIn),
        mileage_out: numberOrNull(mileageOut),
        customer_concern: valueOrNull(concern),
        notes: valueOrNull(notes),
        paid,
        paid_at: paid ? initialRo?.paid_at || new Date().toISOString() : null,
        tax_rate: taxRate,
      };

      let roId = initialRo?.id ?? "";
      if (initialRo) {
        const { error } = await supabase.from("repair_orders").update(roPayload).eq("id", initialRo.id);
        if (error) throw error;
        const { error: deleteError } = await supabase.from("line_items").delete().eq("repair_order_id", initialRo.id);
        if (deleteError) throw deleteError;
      } else {
        const { data, error } = await supabase.from("repair_orders").insert(roPayload).select("id").single();
        if (error) throw error;
        roId = data.id as string;
      }

      const linePayload = items.map((item, index) => ({
        owner_id: user.id,
        repair_order_id: roId,
        item_type: item.item_type,
        description: item.description.trim(),
        quantity: item.quantity,
        unit_cost: item.item_type === "part" ? item.unit_cost : null,
        markup_percent: item.item_type === "part" ? item.markup_percent : null,
        unit_price: item.unit_price,
        taxable: item.taxable,
        sort_order: index,
      }));

      const { error: lineError } = await supabase.from("line_items").insert(linePayload);
      if (lineError) throw lineError;

      onSaved(roId);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "The repair order could not be saved.");
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>{initialRo ? `Edit RO #${padRo(initialRo.ro_number)}` : "New repair order"}</h1>
          <p>Use the same record as an estimate, repair order, and invoice.</p>
        </div>
        <div className="button-row">
          <button className="button secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="button primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {message && <div className="notice">{message}</div>}

      <div className="editor-grid">
        <div className="stack">
          <section className="panel">
            <div className="section-heading">
              <h2>Customer</h2>
              <select value={selectedCustomerId} onChange={(event) => chooseCustomer(event.target.value)}>
                <option value="">+ New customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}{customer.phone ? ` — ${customer.phone}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grid two">
              <label className="span-two">
                Name
                <input
                  value={customerForm.name}
                  onChange={(event) => setCustomerForm({ ...customerForm, name: event.target.value })}
                  required
                />
              </label>
              <label className="span-two">
                Address
                <input
                  value={customerForm.address_line_1}
                  onChange={(event) => setCustomerForm({ ...customerForm, address_line_1: event.target.value })}
                />
              </label>
              <label>
                City
                <input value={customerForm.city} onChange={(event) => setCustomerForm({ ...customerForm, city: event.target.value })} />
              </label>
              <div className="mini-grid">
                <label>
                  State
                  <input value={customerForm.state} onChange={(event) => setCustomerForm({ ...customerForm, state: event.target.value })} />
                </label>
                <label>
                  ZIP
                  <input value={customerForm.zip_code} onChange={(event) => setCustomerForm({ ...customerForm, zip_code: event.target.value })} />
                </label>
              </div>
              <label>
                Phone
                <input value={customerForm.phone} onChange={(event) => setCustomerForm({ ...customerForm, phone: event.target.value })} />
              </label>
              <label>
                Email
                <input type="email" value={customerForm.email} onChange={(event) => setCustomerForm({ ...customerForm, email: event.target.value })} />
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="section-heading">
              <h2>Vehicle</h2>
              <select value={selectedVehicleId} onChange={(event) => chooseVehicle(event.target.value)} disabled={!selectedCustomerId}>
                <option value="">+ New vehicle</option>
                {customerVehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {[vehicle.year, vehicle.make, vehicle.model, vehicle.license_plate].filter(Boolean).join(" ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="vin-row">
              <label>
                VIN
                <input
                  value={vehicleForm.vin}
                  maxLength={17}
                  onChange={(event) => setVehicleForm({ ...vehicleForm, vin: event.target.value.toUpperCase() })}
                />
              </label>
              <button className="button secondary" type="button" onClick={decodeVin} disabled={vinBusy}>
                {vinBusy ? "Decoding…" : "Decode VIN"}
              </button>
            </div>
            <div className="form-grid four">
              <label>
                Year
                <input inputMode="numeric" value={vehicleForm.year} onChange={(event) => setVehicleForm({ ...vehicleForm, year: event.target.value })} />
              </label>
              <label>
                Make
                <input value={vehicleForm.make} onChange={(event) => setVehicleForm({ ...vehicleForm, make: event.target.value })} />
              </label>
              <label>
                Model
                <input value={vehicleForm.model} onChange={(event) => setVehicleForm({ ...vehicleForm, model: event.target.value })} />
              </label>
              <label>
                Trim
                <input value={vehicleForm.trim} onChange={(event) => setVehicleForm({ ...vehicleForm, trim: event.target.value })} />
              </label>
              <label className="span-two">
                Engine
                <input value={vehicleForm.engine} onChange={(event) => setVehicleForm({ ...vehicleForm, engine: event.target.value })} />
              </label>
              <label>
                Plate
                <input value={vehicleForm.license_plate} onChange={(event) => setVehicleForm({ ...vehicleForm, license_plate: event.target.value.toUpperCase() })} />
              </label>
              <label>
                Plate state
                <input value={vehicleForm.plate_state} onChange={(event) => setVehicleForm({ ...vehicleForm, plate_state: event.target.value.toUpperCase() })} />
              </label>
            </div>
          </section>

          <section className="panel">
            <h2>Job details</h2>
            <div className="form-grid four">
              <label>
                Document
                <select value={documentType} onChange={(event) => setDocumentType(event.target.value as DocumentType)}>
                  <option value="estimate">Estimate</option>
                  <option value="repair_order">Repair Order</option>
                  <option value="invoice">Invoice</option>
                </select>
              </label>
              <label>
                Status
                <select value={status} onChange={(event) => setStatus(event.target.value as "open" | "completed" | "voided")}>
                  <option value="open">Open</option>
                  <option value="completed">Completed</option>
                  <option value="voided">Voided</option>
                </select>
              </label>
              <label>
                Mileage in
                <input inputMode="numeric" value={mileageIn} onChange={(event) => setMileageIn(event.target.value)} />
              </label>
              <label>
                Mileage out
                <input inputMode="numeric" value={mileageOut} onChange={(event) => setMileageOut(event.target.value)} />
              </label>
              <label className="span-four">
                Customer concern / requested work
                <textarea rows={3} value={concern} onChange={(event) => setConcern(event.target.value)} />
              </label>
              <label className="span-four">
                Internal notes
                <textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
              </label>
            </div>
          </section>
        </div>

        <aside className="panel totals-sidebar">
          <h2>Document settings</h2>
          <label>
            Sales-tax rate %
            <input type="number" step="0.001" value={taxRate} onChange={(event) => setTaxRate(Number(event.target.value) || 0)} />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} />
            Mark paid
          </label>
          <div className="totals-box">
            <div><span>Subtotal</span><strong>{money(totals.subtotal)}</strong></div>
            <div><span>Tax</span><strong>{money(totals.tax)}</strong></div>
            <div className="grand-total"><span>Total</span><strong>{money(totals.total)}</strong></div>
          </div>
        </aside>
      </div>

      <section className="panel line-items-panel">
        <div className="section-heading wrap">
          <div>
            <h2>Line items</h2>
            <p className="muted">Labor defaults to {money(settings.default_labor_rate)}/hr. Parts default to {settings.default_parts_markup}% markup.</p>
          </div>
          <div className="button-row">
            <button className="button small secondary" onClick={() => addItem("labor")}>+ Labor</button>
            <button className="button small secondary" onClick={() => addItem("part")}>+ Part</button>
            <button className="button small secondary" onClick={() => addItem("fee")}>+ Fee</button>
            <button className="button small secondary" onClick={() => addItem("discount")}>+ Discount</button>
          </div>
        </div>

        <div className="line-items">
          {items.map((item, index) => (
            <div className="line-item" key={item.id}>
              <div className="line-number">{index + 1}</div>
              <label>
                Type
                <select value={item.item_type} onChange={(event) => changeItem(item.id, "item_type", event.target.value)}>
                  <option value="labor">Labor</option>
                  <option value="part">Part</option>
                  <option value="fee">Fee</option>
                  <option value="discount">Discount</option>
                </select>
              </label>
              <label className="description-field">
                Description
                <input value={item.description} onChange={(event) => changeItem(item.id, "description", event.target.value)} />
              </label>
              <label>
                {item.item_type === "labor" ? "Hours" : "Qty"}
                <input type="number" step="0.01" value={item.quantity} onChange={(event) => changeItem(item.id, "quantity", event.target.value)} />
              </label>
              {item.item_type === "part" && (
                <>
                  <label>
                    Your cost
                    <input type="number" step="0.01" value={item.unit_cost ?? 0} onChange={(event) => changeItem(item.id, "unit_cost", event.target.value)} />
                  </label>
                  <label>
                    Markup %
                    <input type="number" step="0.01" value={Number(item.markup_percent ?? 0).toFixed(2)} onChange={(event) => changeItem(item.id, "markup_percent", event.target.value)} />
                  </label>
                </>
              )}
              <label>
                {item.item_type === "labor" ? "Rate" : item.item_type === "discount" ? "Discount" : "Unit price"}
                <input
                  type="number"
                  step="0.01"
                  value={item.item_type === "discount" ? Math.abs(item.unit_price) : Number(item.unit_price.toFixed(2))}
                  onChange={(event) => changeItem(item.id, "unit_price", event.target.value)}
                />
              </label>
              <label className="checkbox-row compact">
                <input type="checkbox" checked={item.taxable} onChange={(event) => changeItem(item.id, "taxable", event.target.checked)} />
                Tax
              </label>
              <div className="line-total">
                <span>Total</span>
                <strong>{money(item.quantity * item.unit_price)}</strong>
              </div>
              <button className="icon-button" title="Remove line" onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}>
                ×
              </button>
            </div>
          ))}
        </div>
      </section>

      <div className="bottom-actions">
        <button className="button secondary" onClick={onCancel}>Cancel</button>
        <button className="button primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save repair order"}</button>
      </div>
    </section>
  );
}

function CustomerDirectory({
  customers,
  vehicles,
  repairOrders,
}: {
  customers: Customer[];
  vehicles: Vehicle[];
  repairOrders: RepairOrder[];
}) {
  const [search, setSearch] = useState("");
  const query = search.toLowerCase().trim();
  const filtered = customers.filter((customer) => {
    const customerVehicles = vehicles.filter((vehicle) => vehicle.customer_id === customer.id);
    const text = [
      customer.name,
      customer.phone,
      customer.email,
      ...customerVehicles.flatMap((vehicle) => [vehicle.year, vehicle.make, vehicle.model, vehicle.vin, vehicle.license_plate]),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return !query || text.includes(query);
  });

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Customers & vehicles</h1>
          <p>Search the stored customer and vehicle history.</p>
        </div>
      </div>
      <div className="panel">
        <input className="search-input" placeholder="Search name, phone, VIN, plate, vehicle…" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      <div className="customer-grid">
        {filtered.map((customer) => {
          const ownedVehicles = vehicles.filter((vehicle) => vehicle.customer_id === customer.id);
          const roCount = repairOrders.filter((ro) => ro.customer_id === customer.id).length;
          return (
            <article className="panel customer-card" key={customer.id}>
              <div className="section-heading">
                <div>
                  <h2>{customer.name}</h2>
                  <p className="muted">{customer.phone || "No phone"}{customer.email ? ` · ${customer.email}` : ""}</p>
                </div>
                <span className="badge neutral">{roCount} RO{roCount === 1 ? "" : "s"}</span>
              </div>
              {(customer.address_line_1 || customer.city) && (
                <p>{[customer.address_line_1, customer.city, customer.state, customer.zip_code].filter(Boolean).join(", ")}</p>
              )}
              <div className="vehicle-list">
                {ownedVehicles.map((vehicle) => (
                  <div key={vehicle.id}>
                    <strong>{[vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ") || "Vehicle"}</strong>
                    <span>{[vehicle.license_plate, vehicle.vin].filter(Boolean).join(" · ")}</span>
                  </div>
                ))}
                {!ownedVehicles.length && <span className="muted">No vehicles saved.</span>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SettingsPanel({
  user,
  initialSettings,
  onSaved,
}: {
  user: User;
  initialSettings: Settings;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Settings>(initialSettings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setBusy(true);
    setMessage("");
    const payload = { ...form, owner_id: user.id };
    const { error } = await supabase.from("settings").upsert(payload, { onConflict: "owner_id" });
    if (error) {
      setMessage(error.message);
      setBusy(false);
      return;
    }
    onSaved();
  }

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Settings</h1>
          <p>Business information and default pricing.</p>
        </div>
        <button className="button primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
      </div>
      {message && <div className="notice">{message}</div>}
      <div className="panel settings-panel">
        <div className="form-grid two">
          <label className="span-two">
            Business name
            <input value={form.business_name} onChange={(event) => setForm({ ...form, business_name: event.target.value })} />
          </label>
          <label className="span-two">
            Business address
            <input value={form.business_address || ""} onChange={(event) => setForm({ ...form, business_address: event.target.value })} />
          </label>
          <label>
            Business phone
            <input value={form.business_phone || ""} onChange={(event) => setForm({ ...form, business_phone: event.target.value })} />
          </label>
          <label>
            Business email
            <input type="email" value={form.business_email || ""} onChange={(event) => setForm({ ...form, business_email: event.target.value })} />
          </label>
          <label>
            Default labor rate
            <input type="number" step="0.01" value={form.default_labor_rate} onChange={(event) => setForm({ ...form, default_labor_rate: Number(event.target.value) || 0 })} />
          </label>
          <label>
            Default parts markup %
            <input type="number" step="0.01" value={form.default_parts_markup} onChange={(event) => setForm({ ...form, default_parts_markup: Number(event.target.value) || 0 })} />
          </label>
          <label>
            Default sales-tax rate %
            <input type="number" step="0.001" value={form.sales_tax_rate} onChange={(event) => setForm({ ...form, sales_tax_rate: Number(event.target.value) || 0 })} />
          </label>
          <label className="span-two">
            Document footer
            <textarea rows={5} value={form.invoice_footer} onChange={(event) => setForm({ ...form, invoice_footer: event.target.value })} />
          </label>
        </div>
      </div>
    </section>
  );
}

function DocumentView({
  ro,
  settings,
  onBack,
  onEdit,
}: {
  ro: RepairOrder;
  settings: Settings;
  onBack: () => void;
  onEdit: () => void;
}) {
  const items = ro.line_items ?? [];
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const taxableSubtotal = items.reduce((sum, item) => sum + (item.taxable ? item.quantity * item.unit_price : 0), 0);
  const tax = Math.max(0, taxableSubtotal) * (Number(ro.tax_rate) / 100);
  const total = subtotal + tax;
  const customer = ro.customers;
  const vehicle = ro.vehicles;

  return (
    <section className="document-shell">
      <div className="document-actions no-print">
        <button className="button secondary" onClick={onBack}>← Back</button>
        <div className="button-row">
          <button className="button secondary" onClick={onEdit}>Edit</button>
          <button className="button primary" onClick={() => window.print()}>Print / Save PDF</button>
        </div>
      </div>

      <article className="document-page">
        <header className="document-header">
          <div>
            <h1>{settings.business_name}</h1>
            {settings.business_address && <p>{settings.business_address}</p>}
            <p>{[settings.business_phone, settings.business_email].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="document-title">
            <h2>{labelDocument(ro.document_type)}</h2>
            <strong>RO #{padRo(ro.ro_number)}</strong>
            <span>{new Date(ro.created_at).toLocaleDateString()}</span>
          </div>
        </header>

        <div className="document-info-grid">
          <section>
            <h3>Customer</h3>
            <strong>{customer?.name}</strong>
            <span>{customer?.address_line_1}</span>
            <span>{[customer?.city, customer?.state, customer?.zip_code].filter(Boolean).join(", ")}</span>
            <span>{customer?.phone}</span>
            <span>{customer?.email}</span>
          </section>
          <section>
            <h3>Vehicle</h3>
            <strong>{[vehicle?.year, vehicle?.make, vehicle?.model, vehicle?.trim].filter(Boolean).join(" ")}</strong>
            <span>VIN: {vehicle?.vin || "—"}</span>
            <span>Plate: {[vehicle?.license_plate, vehicle?.plate_state].filter(Boolean).join(" ") || "—"}</span>
            <span>Engine: {vehicle?.engine || "—"}</span>
          </section>
          <section>
            <h3>Mileage</h3>
            <span>In: {ro.mileage_in?.toLocaleString() || "—"}</span>
            <span>Out: {ro.mileage_out?.toLocaleString() || "—"}</span>
            <span className={`document-payment ${ro.paid ? "paid" : "unpaid"}`}>{ro.paid ? "PAID" : "UNPAID"}</span>
            {ro.paid_at && <span>Paid {new Date(ro.paid_at).toLocaleDateString()}</span>}
          </section>
        </div>

        {ro.customer_concern && (
          <section className="concern-box">
            <h3>Customer concern / requested work</h3>
            <p>{ro.customer_concern}</p>
          </section>
        )}

        <table className="document-table">
          <thead>
            <tr>
              <th>Description</th>
              <th>Type</th>
              <th>Qty/Hrs</th>
              <th>Rate/Price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.description}</td>
                <td>{item.item_type.charAt(0).toUpperCase() + item.item_type.slice(1)}</td>
                <td>{item.quantity}</td>
                <td>{money(item.item_type === "discount" ? Math.abs(item.unit_price) : item.unit_price)}</td>
                <td>{money(item.quantity * item.unit_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="document-bottom">
          <div className="document-notes">
            {ro.notes && (
              <>
                <h3>Notes</h3>
                <p>{ro.notes}</p>
              </>
            )}
          </div>
          <div className="document-totals">
            <div><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
            <div><span>Tax ({Number(ro.tax_rate).toFixed(3)}%)</span><strong>{money(tax)}</strong></div>
            <div className="grand-total"><span>Total</span><strong>{money(total)}</strong></div>
          </div>
        </div>

        <footer className="document-footer">{settings.invoice_footer}</footer>
      </article>
    </section>
  );
}
