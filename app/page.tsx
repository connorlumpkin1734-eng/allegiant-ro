"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { MultipointInspection } from "@/components/MultipointInspection";
import { supabase } from "@/lib/supabase";

type View = "dashboard" | "editor" | "customers" | "customer_profile" | "settings" | "document" | "inspection";
type DocumentMode = "estimate" | "work_order" | "invoice";
type WorkspaceTab = "work_order" | "invoice";
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
  archived_at: string | null;
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
  service_group_id: string | null;
  service_group_title: string | null;
  technician_story: string | null;
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
  archived_at: string | null;
  estimate_status?: "not_sent" | "sent" | "approved" | "declined";
  estimate_sent_at?: string | null;
  estimate_responded_at?: string | null;
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

function statusLabel(status: RepairOrder["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function repairOrderTotal(ro: RepairOrder): number {
  const items = ro.line_items ?? [];
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const taxableSubtotal = items.reduce(
    (sum, item) => sum + (item.taxable ? item.quantity * item.unit_price : 0),
    0
  );
  return subtotal + Math.max(0, taxableSubtotal) * (Number(ro.tax_rate) / 100);
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

function emptyLine(
  type: ItemType,
  settings: Settings,
  index: number,
  groupId: string | null = null,
  groupTitle: string | null = null,
  technicianStory: string | null = null
): LineItem {
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
      service_group_id: groupId,
      service_group_title: groupTitle,
      technician_story: technicianStory,
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
      service_group_id: groupId,
      service_group_title: groupTitle,
      technician_story: technicianStory,
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
    service_group_id: groupId,
    service_group_title: groupTitle,
    technician_story: technicianStory,
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
        <p className="muted">Work orders, estimates, and invoices.</p>
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
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [editingRo, setEditingRo] = useState<RepairOrder | null>(null);
  const [newContext, setNewContext] = useState<{ customerId: string; vehicleId: string }>({ customerId: "", vehicleId: "" });
  const [documentMode, setDocumentMode] = useState<DocumentMode>("work_order");
  const [documentReturnView, setDocumentReturnView] = useState<"dashboard" | "customer_profile" | "editor">("dashboard");
  const [inspectionReturnView, setInspectionReturnView] = useState<"dashboard" | "customer_profile" | "editor" | "document">("dashboard");
  const [editorTab, setEditorTab] = useState<WorkspaceTab>("work_order");
  const [editorReturnView, setEditorReturnView] = useState<"dashboard" | "customer_profile">("dashboard");
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
        .select("*, customers(*), vehicles(*), line_items(*)")
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

    const loadedRos = ((roResult.data ?? []) as RepairOrder[]).map((ro) => ({
      ...ro,
      line_items: [...(ro.line_items ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    }));

    setSettings(loadedSettings ?? defaultSettings);
    setCustomers((customersResult.data ?? []) as Customer[]);
    setVehicles((vehiclesResult.data ?? []) as Vehicle[]);
    setRepairOrders(loadedRos);

    if (selectedCustomer) {
      const refreshed = ((customersResult.data ?? []) as Customer[]).find((customer) => customer.id === selectedCustomer.id);
      setSelectedCustomer(refreshed ?? null);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openDocument(
    id: string,
    mode: DocumentMode = "work_order",
    returnView: "dashboard" | "customer_profile" | "editor" = "dashboard"
  ) {
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
    setDocumentMode(mode);
    setDocumentReturnView(returnView);
    setView("document");
  }

  async function editDocument(
    id: string,
    returnView: "dashboard" | "customer_profile" = "dashboard",
    tab: WorkspaceTab = "work_order"
  ) {
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
    setNewContext({ customerId: loaded.customer_id, vehicleId: loaded.vehicle_id });
    setEditorReturnView(returnView);
    setEditorTab(tab);
    setView("editor");
  }

  async function openInspection(
    id: string,
    returnView: "dashboard" | "customer_profile" | "editor" | "document" = "dashboard"
  ) {
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
    setInspectionReturnView(returnView);
    setView("inspection");
  }

  function startNew(customerId = "", vehicleId = "", returnView: "dashboard" | "customer_profile" = "dashboard") {
    setEditingRo(null);
    setNewContext({ customerId, vehicleId });
    setEditorReturnView(returnView);
    setEditorTab("work_order");
    setView("editor");
  }

  function openCustomer(customer: Customer) {
    setSelectedCustomer(customer);
    setView("customer_profile");
  }

  async function refreshCurrentDocument(id: string) {
    await loadData();
    if (view === "document" && selectedRo?.id === id) {
      await openDocument(id, documentMode, documentReturnView);
    }
  }

  async function toggleVoid(ro: RepairOrder) {
    const reopening = ro.status === "voided";
    const verb = reopening ? "reopen" : "void";
    if (!reopening && !window.confirm(`Void RO #${padRo(ro.ro_number)}? The record will stay in your history and can be reopened later.`)) {
      return;
    }

    setError("");
    const { error: updateError } = await supabase
      .from("repair_orders")
      .update({ status: reopening ? "open" : "voided" })
      .eq("id", ro.id);

    if (updateError) {
      setError(`Could not ${verb} RO #${padRo(ro.ro_number)}: ${updateError.message}`);
      return;
    }

    await refreshCurrentDocument(ro.id);
  }

  async function updateRoStatus(ro: RepairOrder, status: "open" | "completed") {
    if (ro.status === status) return;

    setError("");
    const { error: updateError } = await supabase
      .from("repair_orders")
      .update({ status })
      .eq("id", ro.id);

    if (updateError) {
      setError(`Could not update RO #${padRo(ro.ro_number)} status: ${updateError.message}`);
      return;
    }

    await loadData();
  }

  async function updateRoPaidStatus(ro: RepairOrder, paid: boolean) {
    if (ro.paid === paid) return;

    setError("");
    const { error: updateError } = await supabase
      .from("repair_orders")
      .update({
        paid,
        paid_at: paid ? ro.paid_at || new Date().toISOString() : null,
      })
      .eq("id", ro.id);

    if (updateError) {
      setError(`Could not update RO #${padRo(ro.ro_number)} payment status: ${updateError.message}`);
      return;
    }

    await loadData();
  }

  async function toggleArchiveRo(ro: RepairOrder) {
    const restoring = Boolean(ro.archived_at);
    if (!restoring && !window.confirm(`Archive RO #${padRo(ro.ro_number)}? It will be hidden from the normal dashboard but can be restored.`)) {
      return;
    }

    setError("");
    const { error: updateError } = await supabase
      .from("repair_orders")
      .update({ archived_at: restoring ? null : new Date().toISOString() })
      .eq("id", ro.id);

    if (updateError) {
      setError(`Could not ${restoring ? "restore" : "archive"} RO #${padRo(ro.ro_number)}: ${updateError.message}`);
      return;
    }

    await refreshCurrentDocument(ro.id);
  }

  async function deleteRo(ro: RepairOrder) {
    const confirmed = window.confirm(
      `Permanently delete RO #${padRo(ro.ro_number)}?\n\nThis also deletes its line items and saved inspection and cannot be undone.`
    );
    if (!confirmed) return;

    setError("");
    const { error: deleteError } = await supabase.from("repair_orders").delete().eq("id", ro.id);
    if (deleteError) {
      setError(`Could not delete RO #${padRo(ro.ro_number)}: ${deleteError.message}`);
      return;
    }

    if (selectedRo?.id === ro.id) setSelectedRo(null);
    if (editingRo?.id === ro.id) setEditingRo(null);
    const shouldReturnToCustomer =
      selectedCustomer &&
      (view === "customer_profile" || (view === "document" && documentReturnView === "customer_profile"));
    await loadData();
    setView(shouldReturnToCustomer ? "customer_profile" : "dashboard");
  }

  async function toggleArchiveCustomer(customer: Customer) {
    const restoring = Boolean(customer.archived_at);
    if (!restoring && !window.confirm(`Archive ${customer.name}? They will be hidden from the normal customer list and new-work-order selector, but their history will remain.`)) {
      return;
    }

    setError("");
    const { error: updateError } = await supabase
      .from("customers")
      .update({ archived_at: restoring ? null : new Date().toISOString() })
      .eq("id", customer.id);

    if (updateError) {
      setError(`Could not ${restoring ? "restore" : "archive"} ${customer.name}: ${updateError.message}`);
      return;
    }

    await loadData();
  }

  async function deleteCustomer(customer: Customer) {
    const roCount = repairOrders.filter((ro) => ro.customer_id === customer.id).length;
    if (roCount > 0) {
      setError(`${customer.name} has ${roCount} work order${roCount === 1 ? "" : "s"}. Archive the customer instead, or delete those work orders first.`);
      return;
    }

    const confirmed = window.confirm(
      `Permanently delete ${customer.name}?\n\nTheir saved vehicles will also be deleted. This cannot be undone.`
    );
    if (!confirmed) return;

    setError("");
    const { error: deleteError } = await supabase.from("customers").delete().eq("id", customer.id);
    if (deleteError) {
      setError(`Could not delete ${customer.name}: ${deleteError.message}`);
      return;
    }

    setSelectedCustomer(null);
    await loadData();
    setView("customers");
  }

  const returnFromDocument = () => {
    if (documentReturnView === "editor" && selectedRo) {
      void editDocument(selectedRo.id, editorReturnView, editorTab);
    } else if (documentReturnView === "customer_profile" && selectedCustomer) {
      setView("customer_profile");
    } else {
      setView("dashboard");
    }
  };

  const returnFromEditor = () => {
    if (editorReturnView === "customer_profile" && selectedCustomer) {
      setView("customer_profile");
    } else {
      setView("dashboard");
    }
  };

  const returnFromInspection = () => {
    if (!selectedRo) {
      setView("dashboard");
    } else if (inspectionReturnView === "editor") {
      void editDocument(selectedRo.id, editorReturnView, editorTab);
    } else if (inspectionReturnView === "document") {
      setView("document");
    } else if (inspectionReturnView === "customer_profile" && selectedCustomer) {
      setView("customer_profile");
    } else {
      setView("dashboard");
    }
  };

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
            Work Orders
          </button>
          <button onClick={() => startNew()}>New Work Order</button>
          <button className={view === "customers" || view === "customer_profile" ? "active" : ""} onClick={() => setView("customers")}>
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
          <Dashboard
            repairOrders={repairOrders}
            onNew={() => startNew()}
            onOpen={(id, mode) => {
              const ro = repairOrders.find((entry) => entry.id === id);
              if (ro?.archived_at) {
                void openDocument(id, mode, "dashboard");
              } else {
                void editDocument(id, "dashboard", mode === "invoice" ? "invoice" : "work_order");
              }
            }}
            onEdit={(id) => editDocument(id, "dashboard", "work_order")}
            onInspection={(id) => openInspection(id, "dashboard")}
            onOpenCustomer={openCustomer}
            onStatusChange={updateRoStatus}
            onPaidChange={updateRoPaidStatus}
          />
        ) : view === "editor" ? (
          <RepairOrderEditor
            key={editingRo?.id ?? "new-repair-order"}
            user={user}
            settings={settings}
            customers={customers}
            vehicles={vehicles}
            initialRo={editingRo}
            initialCustomerId={newContext.customerId}
            initialVehicleId={newContext.vehicleId}
            initialTab={editorTab}
            onInspection={editingRo ? () => openInspection(editingRo.id, "editor") : undefined}
            onCancel={returnFromEditor}
            onSaved={async (id, tab, previewMode) => {
              setEditorTab(tab);
              await loadData();
              if (previewMode) {
                await openDocument(id, previewMode, "editor");
              } else {
                await editDocument(id, editorReturnView, tab);
              }
            }}
          />
        ) : view === "customers" ? (
          <CustomerDirectory
            customers={customers}
            vehicles={vehicles}
            repairOrders={repairOrders}
            onOpenCustomer={openCustomer}
            onArchive={toggleArchiveCustomer}
            onDelete={deleteCustomer}
          />
        ) : view === "customer_profile" && selectedCustomer ? (
          <CustomerProfile
            customer={selectedCustomer}
            vehicles={vehicles}
            repairOrders={repairOrders}
            onBack={() => setView("customers")}
            onOpenRo={(id, mode) => {
              const ro = repairOrders.find((entry) => entry.id === id);
              if (ro?.archived_at) {
                void openDocument(id, mode, "customer_profile");
              } else {
                void editDocument(id, "customer_profile", mode === "invoice" ? "invoice" : "work_order");
              }
            }}
            onNew={(customerId, vehicleId) => startNew(customerId, vehicleId, "customer_profile")}
            onArchive={toggleArchiveCustomer}
            onDelete={deleteCustomer}
          />
        ) : view === "settings" ? (
          <SettingsPanel
            user={user}
            initialSettings={settings}
            onSaved={async () => {
              await loadData();
              setView("dashboard");
            }}
          />
        ) : view === "inspection" && selectedRo ? (
          <MultipointInspection ro={selectedRo} userId={user.id} onBack={returnFromInspection} />
        ) : selectedRo ? (
          <DocumentView
            ro={selectedRo}
            settings={settings}
            mode={documentMode}
            onModeChange={setDocumentMode}
            onBack={returnFromDocument}
            onEdit={() => editDocument(
              selectedRo.id,
              documentReturnView === "customer_profile" ? "customer_profile" : editorReturnView,
              documentMode === "invoice" ? "invoice" : "work_order"
            )}
            onInspection={() => openInspection(selectedRo.id, "document")}
            onVoid={() => toggleVoid(selectedRo)}
            onArchive={() => toggleArchiveRo(selectedRo)}
            onDelete={() => deleteRo(selectedRo)}
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
  onInspection,
  onOpenCustomer,
  onStatusChange,
  onPaidChange,
}: {
  repairOrders: RepairOrder[];
  onNew: () => void;
  onOpen: (id: string, mode: DocumentMode) => void;
  onEdit: (id: string) => void;
  onInspection: (id: string) => void;
  onOpenCustomer: (customer: Customer) => void;
  onStatusChange: (ro: RepairOrder, status: "open" | "completed") => Promise<void>;
  onPaidChange: (ro: RepairOrder, paid: boolean) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const normalized = search.toLowerCase().trim();

  async function changeStatus(ro: RepairOrder, status: "open" | "completed") {
    setSavingId(ro.id);
    try {
      await onStatusChange(ro, status);
    } finally {
      setSavingId(null);
    }
  }

  async function changePaidStatus(ro: RepairOrder, paid: boolean) {
    setSavingId(ro.id);
    try {
      await onPaidChange(ro, paid);
    } finally {
      setSavingId(null);
    }
  }

  const visibleRecords = repairOrders.filter((ro) => showArchived || !ro.archived_at);
  const filtered = visibleRecords.filter((ro) => {
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
      ro.status,
      ro.paid ? "paid" : "unpaid",
      ro.archived_at ? "archived" : "",
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalized);
  });

  const activeRecords = repairOrders.filter((ro) => !ro.archived_at);
  const archivedCount = repairOrders.length - activeRecords.length;
  const openCount = activeRecords.filter((ro) => ro.status === "open").length;
  const unpaidCount = activeRecords.filter(
    (ro) => ro.status === "completed" && !ro.paid
  ).length;

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Work Orders</h1>
          <p>One job record. Print it as an estimate, use it as the shop work order, and issue the final invoice.</p>
        </div>
        <button className="button primary" onClick={onNew}>
          + New Work Order
        </button>
      </div>

      <div className="summary-grid">
        <div className="summary-card">
          <span>Active work orders</span>
          <strong>{activeRecords.length}</strong>
        </div>
        <div className="summary-card">
          <span>Open jobs</span>
          <strong>{openCount}</strong>
        </div>
        <div className="summary-card">
          <span>Completed & unpaid</span>
          <strong>{unpaidCount}</strong>
        </div>
      </div>

      <div className="panel">
        <div className="toolbar toolbar-between">
          <input
            className="search-input"
            placeholder="Search customer, phone, VIN, plate, RO, vehicle…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <label className="checkbox-row archive-toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            Show archived ({archivedCount})
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>RO</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Vehicle</th>
                <th>Job status</th>
                <th>Invoice</th>
                <th>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ro) => (
                <tr key={ro.id} className={ro.archived_at ? "archived-row" : ""}>
                  <td className="ro-number">#{padRo(ro.ro_number)}</td>
                  <td>{new Date(ro.created_at).toLocaleDateString()}</td>
                  <td>
                    {ro.customers ? (
                      <button className="table-link" onClick={() => onOpenCustomer(ro.customers as Customer)}>
                        {ro.customers.name}
                      </button>
                    ) : "—"}
                  </td>
                  <td>
                    {[ro.vehicles?.year, ro.vehicles?.make, ro.vehicles?.model].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td>
                    <div className="badge-row">
                      {ro.archived_at || ro.status === "voided" ? (
                        <span className={`badge ${ro.status}`}>{statusLabel(ro.status)}</span>
                      ) : (
                        <select
                          className={`status-select ${ro.status}`}
                          aria-label={`Job status for RO ${padRo(ro.ro_number)}`}
                          value={ro.status}
                          disabled={savingId === ro.id}
                          onChange={(event) => void changeStatus(ro, event.target.value as "open" | "completed")}
                        >
                          <option value="open">Open</option>
                          <option value="completed">Completed</option>
                        </select>
                      )}
                      {ro.estimate_status && ro.estimate_status !== "not_sent" && (
                        <span className={`badge estimate-${ro.estimate_status}`}>
                          {ro.estimate_status === "sent" ? "Estimate sent" : ro.estimate_status}
                        </span>
                      )}
                      {ro.archived_at && <span className="badge archived">Archived</span>}
                    </div>
                  </td>
                  <td>
                    {ro.archived_at || ro.status === "voided" ? (
                      <span className={`badge ${ro.paid ? "paid" : ro.status === "completed" ? "unpaid" : "neutral"}`}>
                        {ro.paid ? "Paid" : ro.status === "completed" ? "Unpaid" : "Not final"}
                      </span>
                    ) : (
                      <select
                        className={`status-select ${ro.paid ? "paid" : "unpaid"}`}
                        aria-label={`Payment status for RO ${padRo(ro.ro_number)}`}
                        value={ro.paid ? "paid" : "unpaid"}
                        disabled={savingId === ro.id}
                        onChange={(event) => void changePaidStatus(ro, event.target.value === "paid")}
                      >
                        <option value="unpaid">Unpaid</option>
                        <option value="paid">Paid</option>
                      </select>
                    )}
                  </td>
                  <td>{money(repairOrderTotal(ro))}</td>
                  <td className="actions-cell">
                    <button className="button small primary" onClick={() => onInspection(ro.id)}>
                      Inspection
                    </button>
                    <button className="button small secondary" onClick={() => onOpen(ro.id, "work_order")}>
                      Work order
                    </button>
                    <button className="button small ghost" onClick={() => onOpen(ro.id, "invoice")}>
                      Invoice
                    </button>
                    {!ro.archived_at && (
                      <button className="button small ghost" onClick={() => onEdit(ro.id)}>
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={8} className="empty-state">
                    {showArchived ? "No matching work orders." : "No matching active work orders."}
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
  initialCustomerId,
  initialVehicleId,
  initialTab,
  onInspection,
  onCancel,
  onSaved,
}: {
  user: User;
  settings: Settings;
  customers: Customer[];
  vehicles: Vehicle[];
  initialRo: RepairOrder | null;
  initialCustomerId: string;
  initialVehicleId: string;
  initialTab: WorkspaceTab;
  onInspection?: () => void;
  onCancel: () => void;
  onSaved: (id: string, tab: WorkspaceTab, previewMode?: DocumentMode) => void;
}) {
  const preselectedVehicle = vehicles.find((vehicle) => vehicle.id === initialVehicleId);
  const preselectedCustomerId = initialRo?.customer_id ?? initialCustomerId ?? preselectedVehicle?.customer_id ?? "";
  const preselectedVehicleId = initialRo?.vehicle_id ?? initialVehicleId ?? "";
  const [selectedCustomerId, setSelectedCustomerId] = useState(preselectedCustomerId);
  const [selectedVehicleId, setSelectedVehicleId] = useState(preselectedVehicleId);
  const [customerForm, setCustomerForm] = useState<CustomerForm>(() => {
    const customer = initialRo?.customers ?? customers.find((entry) => entry.id === preselectedCustomerId);
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
    const vehicle = initialRo?.vehicles ?? vehicles.find((entry) => entry.id === preselectedVehicleId);
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
      : [emptyLine("labor", settings, 0, crypto.randomUUID(), "New Service Job", "")]
  );
  const [busy, setBusy] = useState(false);
  const [vinBusy, setVinBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(initialTab);

  async function emailEstimate() {
    if (!initialRo) return;
    if (!customerForm.email.trim()) {
      setMessage("Add the customer's email address before sending the estimate.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Your session expired. Sign in again before sending.");

      const response = await fetch("/.netlify/functions/send-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ repairOrderId: initialRo.id }),
      });
      const body = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(body.error || "The estimate could not be emailed.");
      setMessage(body.message || `Estimate emailed to ${customerForm.email.trim()}.`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "The estimate could not be emailed.");
    } finally {
      setBusy(false);
    }
  }

  const selectableCustomers = useMemo(
    () => customers.filter((customer) => !customer.archived_at || customer.id === initialRo?.customer_id),
    [customers, initialRo?.customer_id]
  );

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

  const serviceGroups = useMemo(() => {
    const grouped = new Map<string, LineItem[]>();
    for (const item of items) {
      if (!item.service_group_id) continue;
      const groupItems = grouped.get(item.service_group_id) ?? [];
      groupItems.push(item);
      grouped.set(item.service_group_id, groupItems);
    }
    return [...grouped.entries()].map(([id, groupItems]) => ({ id, items: groupItems }));
  }, [items]);
  const ungroupedItems = useMemo(() => items.filter((item) => !item.service_group_id), [items]);

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

  function addItem(type: ItemType, groupId: string | null = null) {
    setItems((current) => {
      const groupedItem = groupId ? current.find((item) => item.service_group_id === groupId) : null;
      return [...current, emptyLine(
        type,
        settings,
        current.length,
        groupId,
        groupedItem?.service_group_title ?? null,
        groupedItem?.technician_story ?? null
      )];
    });
  }

  function addServiceJob() {
    const groupId = crypto.randomUUID();
    setItems((current) => [
      ...current,
      emptyLine("labor", settings, current.length, groupId, "New Service Job", ""),
    ]);
  }

  function updateServiceJob(groupId: string, field: "service_group_title" | "technician_story", value: string) {
    setItems((current) => current.map((item) =>
      item.service_group_id === groupId ? { ...item, [field]: value } : item
    ));
  }

  function changeItem(id: string, field: keyof LineItem, rawValue: string | boolean | number) {
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item };

        if (field === "item_type") {
          return emptyLine(
            rawValue as ItemType,
            settings,
            item.sort_order,
            item.service_group_id,
            item.service_group_title,
            item.technician_story
          );
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

  async function save(previewMode?: DocumentMode) {
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
        document_type: "repair_order" as DocumentType,
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
        service_group_id: item.service_group_id,
        service_group_title: valueOrNull(item.service_group_title ?? ""),
        technician_story: valueOrNull(item.technician_story ?? ""),
      }));

      const { error: lineError } = await supabase.from("line_items").insert(linePayload);
      if (lineError) throw lineError;

      setBusy(false);
      onSaved(roId, workspaceTab, previewMode);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "The work order could not be saved.");
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="workspace-heading">
        <div>
          <h1>{initialRo ? `RO #${padRo(initialRo.ro_number)}` : "New Work Order"}</h1>
          <p>One editable job. The estimate, shop work order, and invoice all use this same set of charges.</p>
        </div>
        <div className="button-row">
          <button className="button secondary" onClick={onCancel}>Close</button>
          {initialRo && workspaceTab === "work_order" && onInspection && (
            <button className="button primary" onClick={onInspection}>Multipoint Inspection</button>
          )}
          {initialRo && workspaceTab === "work_order" && (
            <>
              <button className="button ghost" onClick={() => save("estimate")} disabled={busy}>Preview Estimate</button>
              <button className="button ghost" onClick={() => save("work_order")} disabled={busy}>Preview Work Order</button>
              <button className="button primary" onClick={() => void emailEstimate()} disabled={busy}>Email Estimate</button>
            </>
          )}
          {initialRo && workspaceTab === "invoice" && (
            <button className="button ghost" onClick={() => save("invoice")} disabled={busy}>Preview Invoice</button>
          )}
          <button className="button primary" onClick={() => save()} disabled={busy}>
            {busy ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      <div className="workspace-tabs" role="tablist" aria-label="RO workspace">
        <button
          type="button"
          role="tab"
          aria-selected={workspaceTab === "work_order"}
          className={workspaceTab === "work_order" ? "active" : ""}
          onClick={() => setWorkspaceTab("work_order")}
        >
          <span>Work Order</span>
          <small>Edit the job and print the customer estimate or shop copy</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={workspaceTab === "invoice"}
          className={workspaceTab === "invoice" ? "active" : ""}
          onClick={() => setWorkspaceTab("invoice")}
        >
          <span>Invoice</span>
          <small>Same editable charges, plus payment status and final billing</small>
        </button>
      </div>

      {!initialRo && (
        <div className="notice workspace-notice">Save this new work order once before previewing or printing documents.</div>
      )}
      {message && <div className="notice">{message}</div>}

      <div className="editor-grid">
        <div className="stack">
          {workspaceTab === "work_order" ? (
          <>
          <section className="panel">
            <div className="section-heading">
              <h2>Customer</h2>
              <select value={selectedCustomerId} onChange={(event) => chooseCustomer(event.target.value)}>
                <option value="">+ New customer</option>
                {selectableCustomers.map((customer) => (
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
          </>
          ) : (
            <>
              <section className="panel invoice-workspace-summary">
                <div className="section-heading">
                  <div>
                    <h2>Invoice for {customerForm.name || "New customer"}</h2>
                    <p className="muted">Changes made to the charges below also change the work order and estimate.</p>
                  </div>
                  {initialRo && <span className={`badge ${paid ? "paid" : "unpaid"}`}>{paid ? "Paid" : "Unpaid"}</span>}
                </div>
                <div className="invoice-summary-grid">
                  <div>
                    <span>Vehicle</span>
                    <strong>{[vehicleForm.year, vehicleForm.make, vehicleForm.model, vehicleForm.trim].filter(Boolean).join(" ") || "Vehicle not entered"}</strong>
                    <small>{vehicleForm.vin ? `VIN ${vehicleForm.vin}` : "No VIN"}</small>
                  </div>
                  <div>
                    <span>Mileage</span>
                    <strong>{mileageIn || "—"} in / {mileageOut || "—"} out</strong>
                    <small>{vehicleForm.license_plate ? `Plate ${vehicleForm.license_plate}` : "No plate"}</small>
                  </div>
                  <div>
                    <span>Job status</span>
                    <strong>{statusLabel(status)}</strong>
                    <small>Switch back to Work Order to edit customer, vehicle, or job details.</small>
                  </div>
                </div>
                {concern && <div className="invoice-concern"><span>Services requested / performed</span><p>{concern}</p></div>}
              </section>
            </>
          )}
        </div>

        <aside className={`panel totals-sidebar ${workspaceTab === "invoice" ? "invoice-sidebar" : ""}`}>
          <h2>{workspaceTab === "invoice" ? "Invoice & payment" : "Current totals"}</h2>
          <label>
            Sales-tax rate %
            <input type="number" step="0.001" value={taxRate} onChange={(event) => setTaxRate(Number(event.target.value) || 0)} />
          </label>
          {workspaceTab === "invoice" ? (
            <>
              <label className="checkbox-row invoice-paid-toggle">
                <input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} />
                Mark invoice paid
              </label>
              <p className="sidebar-help">The paid date is recorded automatically when this is saved.</p>
            </>
          ) : (
            <p className="sidebar-help">Use Preview Estimate to send proposed pricing to the customer. Payment status lives on the Invoice tab.</p>
          )}
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
            <h2>{workspaceTab === "invoice" ? "Invoice service jobs" : "Service jobs"}</h2>
            <p className="muted">
              {workspaceTab === "invoice"
                ? "Labor, related parts, and the technician story stay together on the final invoice."
                : `Build each repair as a job. Labor defaults to ${money(settings.default_labor_rate)}/hr and parts to ${settings.default_parts_markup}% markup.`}
            </p>
          </div>
          <div className="button-row">
            <button className="button primary" onClick={addServiceJob}>+ Add Service Job</button>
            <button className="button secondary" onClick={() => addItem("fee")}>+ Fee</button>
            <button className="button discount-button" onClick={() => addItem("discount")}>+ Discount</button>
          </div>
        </div>

        <div className="service-jobs">
          {serviceGroups.map((group, groupIndex) => {
            const first = group.items[0];
            const jobTotal = group.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
            return (
              <article className="service-job-card" key={group.id}>
                <header className="service-job-header">
                  <div className="service-job-number">{groupIndex + 1}</div>
                  <label>
                    Service job
                    <input value={first.service_group_title ?? ""} onChange={(event) => updateServiceJob(group.id, "service_group_title", event.target.value)} />
                  </label>
                  <div className="service-job-total"><span>Job total</span><strong>{money(jobTotal)}</strong></div>
                  <button className="button small danger" onClick={() => setItems((current) => current.filter((item) => item.service_group_id !== group.id))}>Delete job</button>
                </header>
                <label className="technician-story">
                  Technician story - prints on invoice
                  <textarea
                    rows={3}
                    placeholder="Example: Replaced front brake pads and rotors, lubricated slide pins, and bled brakes."
                    value={first.technician_story ?? ""}
                    onChange={(event) => updateServiceJob(group.id, "technician_story", event.target.value)}
                  />
                </label>
                <div className="job-lines">
                  {group.items.map((item) => (
                    <ChargeLine key={item.id} item={item} changeItem={changeItem} removeItem={() => setItems((current) => current.filter((entry) => entry.id !== item.id))} />
                  ))}
                </div>
                <div className="job-add-actions">
                  <button className="button small secondary" onClick={() => addItem("labor", group.id)}>+ Labor</button>
                  <button className="button small secondary" onClick={() => addItem("part", group.id)}>+ Associated Part</button>
                </div>
              </article>
            );
          })}

          {ungroupedItems.length > 0 && (
            <section className="ungrouped-charges">
              <div>
                <h3>Fees & Discounts</h3>
              </div>
              <div className="job-lines">
                {ungroupedItems.map((item) => (
                  <ChargeLine key={item.id} item={item} changeItem={changeItem} removeItem={() => setItems((current) => current.filter((entry) => entry.id !== item.id))} />
                ))}
              </div>
            </section>
          )}

          {!serviceGroups.length && !ungroupedItems.length && (
            <div className="empty-state">Add a service job to begin building this repair order.</div>
          )}
        </div>
      </section>

      <div className="bottom-actions workspace-bottom-actions">
        <button className="button secondary" onClick={onCancel}>Close</button>
        {initialRo && workspaceTab === "work_order" && onInspection && (
          <button className="button primary" onClick={onInspection}>Multipoint Inspection</button>
        )}
        {initialRo && workspaceTab === "work_order" && (
          <button className="button ghost" onClick={() => save("estimate")} disabled={busy}>Save & Preview Estimate</button>
        )}
        {initialRo && workspaceTab === "invoice" && (
          <button className="button ghost" onClick={() => save("invoice")} disabled={busy}>Save & Preview Invoice</button>
        )}
        <button className="button primary" onClick={() => save()} disabled={busy}>{busy ? "Saving…" : "Save Changes"}</button>
      </div>
    </section>
  );
}

function ChargeLine({
  item,
  changeItem,
  removeItem,
}: {
  item: LineItem;
  changeItem: (id: string, field: keyof LineItem, rawValue: string | boolean | number) => void;
  removeItem: () => void;
}) {
  return (
    <div className={`charge-line ${item.item_type} ${item.item_type === "part" ? "associated-part" : ""}`}>
      <span className="charge-type-label">
        {item.item_type === "discount" ? "Discount applied" : item.item_type}
      </span>
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
        {item.item_type === "labor" ? "Rate" : item.item_type === "discount" ? "Discount amount" : "Unit price"}
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
        <span>{item.item_type === "discount" ? "You save" : "Total"}</span>
        <strong>{money(item.item_type === "discount" ? Math.abs(item.quantity * item.unit_price) : item.quantity * item.unit_price)}</strong>
      </div>
      <button className="icon-button" title="Remove line" onClick={removeItem}>×</button>
    </div>
  );
}

function CustomerDirectory({
  customers,
  vehicles,
  repairOrders,
  onOpenCustomer,
  onArchive,
  onDelete,
}: {
  customers: Customer[];
  vehicles: Vehicle[];
  repairOrders: RepairOrder[];
  onOpenCustomer: (customer: Customer) => void;
  onArchive: (customer: Customer) => void;
  onDelete: (customer: Customer) => void;
}) {
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const query = search.toLowerCase().trim();
  const archivedCount = customers.filter((customer) => customer.archived_at).length;
  const filtered = customers.filter((customer) => {
    if (!showArchived && customer.archived_at) return false;
    const customerVehicles = vehicles.filter((vehicle) => vehicle.customer_id === customer.id);
    const text = [
      customer.name,
      customer.phone,
      customer.email,
      customer.archived_at ? "archived" : "",
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
          <h1>Customers & Vehicles</h1>
          <p>Click a customer to see every saved vehicle and their complete service history.</p>
        </div>
      </div>
      <div className="panel toolbar toolbar-between">
        <input
          className="search-input"
          placeholder="Search name, phone, VIN, plate, vehicle…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <label className="checkbox-row archive-toggle">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          Show archived ({archivedCount})
        </label>
      </div>
      <div className="customer-grid">
        {filtered.map((customer) => {
          const ownedVehicles = vehicles.filter((vehicle) => vehicle.customer_id === customer.id);
          const roCount = repairOrders.filter((ro) => ro.customer_id === customer.id).length;
          return (
            <article
              className={`panel customer-card clickable-card ${customer.archived_at ? "archived-card" : ""}`}
              key={customer.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenCustomer(customer)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onOpenCustomer(customer);
              }}
            >
              <div className="section-heading">
                <div>
                  <h2>{customer.name}</h2>
                  <p className="muted">{customer.phone || "No phone"}{customer.email ? ` · ${customer.email}` : ""}</p>
                </div>
                <div className="badge-row">
                  <span className="badge neutral">{roCount} WO{roCount === 1 ? "" : "s"}</span>
                  <span className="badge neutral">{ownedVehicles.length} vehicle{ownedVehicles.length === 1 ? "" : "s"}</span>
                  {customer.archived_at && <span className="badge archived">Archived</span>}
                </div>
              </div>
              {(customer.address_line_1 || customer.city) && (
                <p>{[customer.address_line_1, customer.city, customer.state, customer.zip_code].filter(Boolean).join(", ")}</p>
              )}
              <div className="vehicle-list">
                {ownedVehicles.slice(0, 3).map((vehicle) => (
                  <div key={vehicle.id}>
                    <strong>{[vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ") || "Vehicle"}</strong>
                    <span>{[vehicle.license_plate, vehicle.vin].filter(Boolean).join(" · ")}</span>
                  </div>
                ))}
                {ownedVehicles.length > 3 && <span className="muted">+ {ownedVehicles.length - 3} more vehicle{ownedVehicles.length - 3 === 1 ? "" : "s"}</span>}
                {!ownedVehicles.length && <span className="muted">No vehicles saved.</span>}
              </div>
              <div className="customer-card-actions" onClick={(event) => event.stopPropagation()}>
                <button className="button small secondary" onClick={() => onOpenCustomer(customer)}>
                  View customer history
                </button>
                <button className="button small ghost" onClick={() => onArchive(customer)}>
                  {customer.archived_at ? "Restore customer" : "Archive customer"}
                </button>
                {roCount === 0 ? (
                  <button className="button small danger" onClick={() => onDelete(customer)}>
                    Permanently delete
                  </button>
                ) : (
                  <span className="history-lock">Has service history — archive only</span>
                )}
              </div>
            </article>
          );
        })}
        {!filtered.length && (
          <div className="panel empty-state">
            {showArchived ? "No matching customers." : "No matching active customers."}
          </div>
        )}
      </div>
    </section>
  );
}

function CustomerProfile({
  customer,
  vehicles,
  repairOrders,
  onBack,
  onOpenRo,
  onNew,
  onArchive,
  onDelete,
}: {
  customer: Customer;
  vehicles: Vehicle[];
  repairOrders: RepairOrder[];
  onBack: () => void;
  onOpenRo: (id: string, mode: DocumentMode) => void;
  onNew: (customerId: string, vehicleId: string) => void;
  onArchive: (customer: Customer) => void;
  onDelete: (customer: Customer) => void;
}) {
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [showArchived, setShowArchived] = useState(true);
  const ownedVehicles = vehicles.filter((vehicle) => vehicle.customer_id === customer.id);
  const allHistory = repairOrders.filter((ro) => ro.customer_id === customer.id);
  const history = allHistory.filter((ro) => {
    if (!showArchived && ro.archived_at) return false;
    return !vehicleFilter || ro.vehicle_id === vehicleFilter;
  });

  return (
    <section>
      <div className="page-heading">
        <div>
          <button className="back-link" onClick={onBack}>← All customers</button>
          <h1>{customer.name}</h1>
          <p>Customer profile, vehicles, and full work-order history.</p>
        </div>
        <div className="button-row">
          <button className="button primary" onClick={() => onNew(customer.id, "")} disabled={Boolean(customer.archived_at)}>
            + New Work Order
          </button>
          <button className="button ghost" onClick={() => onArchive(customer)}>
            {customer.archived_at ? "Restore customer" : "Archive customer"}
          </button>
          {allHistory.length === 0 && (
            <button className="button danger" onClick={() => onDelete(customer)}>
              Delete customer
            </button>
          )}
        </div>
      </div>

      <div className="customer-profile-grid">
        <aside className="panel customer-summary-panel">
          <h2>Customer details</h2>
          <dl className="details-list">
            <div><dt>Phone</dt><dd>{customer.phone || "—"}</dd></div>
            <div><dt>Email</dt><dd>{customer.email || "—"}</dd></div>
            <div><dt>Address</dt><dd>{[customer.address_line_1, customer.address_line_2, customer.city, customer.state, customer.zip_code].filter(Boolean).join(", ") || "—"}</dd></div>
            <div><dt>Status</dt><dd>{customer.archived_at ? "Archived" : "Active"}</dd></div>
          </dl>
          {customer.notes && <div className="profile-notes"><h3>Notes</h3><p>{customer.notes}</p></div>}
        </aside>

        <div className="stack">
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Vehicles</h2>
                <p className="muted">Start a new work order directly on the correct vehicle.</p>
              </div>
            </div>
            <div className="profile-vehicle-grid">
              {ownedVehicles.map((vehicle) => {
                const vehicleHistory = allHistory.filter((ro) => ro.vehicle_id === vehicle.id);
                const latestMileage = vehicleHistory
                  .map((ro) => ro.mileage_out ?? ro.mileage_in ?? 0)
                  .filter(Boolean)
                  .sort((a, b) => b - a)[0];
                return (
                  <article className="profile-vehicle-card" key={vehicle.id}>
                    <div>
                      <h3>{[vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ") || "Vehicle"}</h3>
                      <p>{vehicle.engine || "Engine not listed"}</p>
                    </div>
                    <dl>
                      <div><dt>VIN</dt><dd>{vehicle.vin || "—"}</dd></div>
                      <div><dt>Plate</dt><dd>{[vehicle.license_plate, vehicle.plate_state].filter(Boolean).join(" ") || "—"}</dd></div>
                      <div><dt>Latest mileage</dt><dd>{latestMileage ? latestMileage.toLocaleString() : "—"}</dd></div>
                      <div><dt>History</dt><dd>{vehicleHistory.length} work order{vehicleHistory.length === 1 ? "" : "s"}</dd></div>
                    </dl>
                    <button className="button small secondary" onClick={() => onNew(customer.id, vehicle.id)} disabled={Boolean(customer.archived_at)}>
                      + New Work Order for This Vehicle
                    </button>
                  </article>
                );
              })}
              {!ownedVehicles.length && <div className="empty-state compact-empty">No vehicles saved for this customer.</div>}
            </div>
          </section>

          <section className="panel">
            <div className="section-heading wrap">
              <div>
                <h2>Service history</h2>
                <p className="muted">Every past work order for this customer, newest first.</p>
              </div>
              <div className="history-filters">
                <select value={vehicleFilter} onChange={(event) => setVehicleFilter(event.target.value)}>
                  <option value="">All vehicles</option>
                  {ownedVehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {[vehicle.year, vehicle.make, vehicle.model, vehicle.license_plate].filter(Boolean).join(" ")}
                    </option>
                  ))}
                </select>
                <label className="checkbox-row archive-toggle">
                  <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
                  Include archived
                </label>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>RO</th>
                    <th>Date</th>
                    <th>Vehicle</th>
                    <th>Requested work</th>
                    <th>Status</th>
                    <th>Invoice</th>
                    <th>Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((ro) => (
                    <tr key={ro.id} className={ro.archived_at ? "archived-row" : ""}>
                      <td className="ro-number">#{padRo(ro.ro_number)}</td>
                      <td>{new Date(ro.created_at).toLocaleDateString()}</td>
                      <td>{[ro.vehicles?.year, ro.vehicles?.make, ro.vehicles?.model].filter(Boolean).join(" ") || "—"}</td>
                      <td className="history-description">{ro.customer_concern || "—"}</td>
                      <td><span className={`badge ${ro.status}`}>{statusLabel(ro.status)}</span></td>
                      <td><span className={`badge ${ro.paid ? "paid" : ro.status === "completed" ? "unpaid" : "neutral"}`}>{ro.paid ? "Paid" : ro.status === "completed" ? "Unpaid" : "Not final"}</span></td>
                      <td>{money(repairOrderTotal(ro))}</td>
                      <td className="actions-cell profile-actions-cell">
                        <button className="button small secondary" onClick={() => onOpenRo(ro.id, "work_order")}>Work order</button>
                        <button className="button small ghost" onClick={() => onOpenRo(ro.id, "invoice")}>Invoice</button>
                      </td>
                    </tr>
                  ))}
                  {!history.length && (
                    <tr><td colSpan={8} className="empty-state">No work orders match this filter.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
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
  mode,
  onModeChange,
  onBack,
  onEdit,
  onInspection,
  onVoid,
  onArchive,
  onDelete,
}: {
  ro: RepairOrder;
  settings: Settings;
  mode: DocumentMode;
  onModeChange: (mode: DocumentMode) => void;
  onBack: () => void;
  onEdit: () => void;
  onInspection: () => void;
  onVoid: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const items = ro.line_items ?? [];
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const taxableSubtotal = items.reduce((sum, item) => sum + (item.taxable ? item.quantity * item.unit_price : 0), 0);
  const tax = Math.max(0, taxableSubtotal) * (Number(ro.tax_rate) / 100);
  const total = subtotal + tax;
  const customer = ro.customers;
  const vehicle = ro.vehicles;
  const isEstimate = mode === "estimate";
  const isWorkOrder = mode === "work_order";
  const isInvoice = mode === "invoice";
  const currentStatusLabel = statusLabel(ro.status);
  const groupedDocumentItems = (() => {
    const groups: Array<{ id: string; title: string; story: string; items: LineItem[] }> = [];
    const byId = new Map<string, { id: string; title: string; story: string; items: LineItem[] }>();
    for (const item of items) {
      if (!item.service_group_id) {
        groups.push({ id: `line-${item.id}`, title: "", story: "", items: [item] });
        continue;
      }
      let group = byId.get(item.service_group_id);
      if (!group) {
        group = {
          id: item.service_group_id,
          title: item.service_group_title || "Service Job",
          story: item.technician_story || "",
          items: [],
        };
        byId.set(item.service_group_id, group);
        groups.push(group);
      }
      group.items.push(item);
    }
    return groups;
  })();

  const title = isEstimate ? "Estimate" : isWorkOrder ? "Work Order" : "Invoice";
  const documentSubtitle = isEstimate
    ? "Proposed work and estimated pricing"
    : isWorkOrder
      ? "Active job record and shop copy"
      : "Final charges and payment record";
  const sectionHeading = isEstimate ? "Proposed services" : isWorkOrder ? "Work to perform" : "Final charges";
  const concernHeading = isEstimate
    ? "Customer request / proposed work"
    : isWorkOrder
      ? "Customer concern / work requested"
      : "Services requested / performed";
  const finalTotalLabel = isEstimate ? "Estimated total" : isWorkOrder ? "Work order total" : "Invoice total";
  const className = isEstimate ? "document-estimate" : isWorkOrder ? "document-repair-order" : "document-invoice";
  return (
    <section className="document-shell">
      <div className="document-actions no-print">
        <button className="button secondary" onClick={onBack}>← Back</button>
        <div className="document-mode-switch" aria-label="Document view">
          <button className={mode === "estimate" ? "active" : ""} onClick={() => onModeChange("estimate")}>Estimate</button>
          <button className={mode === "work_order" ? "active" : ""} onClick={() => onModeChange("work_order")}>Work Order</button>
          <button className={mode === "invoice" ? "active" : ""} onClick={() => onModeChange("invoice")}>Invoice</button>
        </div>
        <div className="button-row">
          {!ro.archived_at && <button className="button secondary" onClick={onEdit}>Edit Work Order</button>}
          <button className="button primary" onClick={onInspection}>Multipoint Inspection</button>
          <button className={`button ${ro.status === "voided" ? "success" : "warning"}`} onClick={onVoid}>
            {ro.status === "voided" ? "Reopen" : "Void"}
          </button>
          <button className="button ghost" onClick={onArchive}>
            {ro.archived_at ? "Restore" : "Archive"}
          </button>
          <button className="button danger" onClick={onDelete}>Delete permanently</button>
          <button className="button primary" onClick={() => window.print()}>Print / Save PDF</button>
        </div>
      </div>
      <article className={`document-page ${className} ${ro.status === "voided" ? "voided-document" : ""}`}>
        {ro.status === "voided" && <div className="void-watermark">VOID</div>}

        <header className="document-header">
          <div>
            <img className="document-logo" src="/allegiant-auto-care-logo.png" alt="Allegiant Auto Care" />
            {settings.business_address && <p>{settings.business_address}</p>}
            <p>{[settings.business_phone, settings.business_email].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="document-title">
            <h2>{title}</h2>
            <p className="document-subtitle">{documentSubtitle}</p>
            <strong>RO #{padRo(ro.ro_number)}</strong>
            <span>{new Date(ro.created_at).toLocaleDateString()}</span>
            <div className="document-status-row">
              {isWorkOrder && <span className={`badge ${ro.status}`}>{currentStatusLabel}</span>}
              {isInvoice && <span className={`badge ${ro.paid ? "paid" : "unpaid"}`}>{ro.paid ? "Paid" : "Unpaid"}</span>}
              {ro.status === "voided" && !isWorkOrder && <span className="badge voided">Voided</span>}
              {ro.archived_at && <span className="badge archived">Archived</span>}
            </div>
          </div>
        </header>

        <section className="document-stage-banner">
          {isEstimate && (
            <>
              <div>
                <span className="stage-eyebrow">Proposal</span>
                <strong>Estimated total</strong>
                <small>Based on the work and parts currently listed below.</small>
              </div>
              <b>{money(total)}</b>
            </>
          )}
          {isWorkOrder && (
            <>
              <div>
                <span className="stage-eyebrow">Job status</span>
                <strong>{currentStatusLabel}</strong>
                <small>Shop copy showing the customer request, vehicle, work, parts, and current totals.</small>
              </div>
              <b>RO #{padRo(ro.ro_number)}</b>
            </>
          )}
          {isInvoice && (
            <>
              <div>
                <span className="stage-eyebrow">{ro.paid ? "Payment received" : "Amount due"}</span>
                <strong>{ro.paid ? "Paid in full" : "Payment due"}</strong>
                <small>{ro.paid && ro.paid_at ? `Paid ${new Date(ro.paid_at).toLocaleDateString()}` : "Final invoice for services and parts."}</small>
              </div>
              <b>{money(total)}</b>
            </>
          )}
        </section>

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
            <h3>{isEstimate ? "Estimate details" : isWorkOrder ? "Work order details" : "Invoice details"}</h3>
            <span>Mileage in: {ro.mileage_in?.toLocaleString() || "—"}</span>
            {!isEstimate && <span>Mileage out: {ro.mileage_out?.toLocaleString() || "—"}</span>}
            {isWorkOrder && <span>Status: {currentStatusLabel}</span>}
            {isInvoice && (
              <>
                <span className={`document-payment ${ro.paid ? "paid" : "unpaid"}`}>{ro.paid ? "PAID" : "UNPAID"}</span>
                {ro.paid_at && <span>Paid {new Date(ro.paid_at).toLocaleDateString()}</span>}
              </>
            )}
          </section>
        </div>

        {ro.customer_concern && (
          <section className="concern-box">
            <h3>{concernHeading}</h3>
            <p>{ro.customer_concern}</p>
          </section>
        )}

        <div className="document-section-heading">
          <h3>{sectionHeading}</h3>
          {isEstimate && <span>Estimated pricing</span>}
          {isWorkOrder && <span>Shop work detail</span>}
          {isInvoice && <span>Final billed amount</span>}
        </div>

        <table className="document-table">
          <thead>
            <tr>
              <th>Description</th>
              <th>Type</th>
              <th>Qty/Hrs</th>
              <th>{isEstimate ? "Est. Rate/Price" : isInvoice ? "Final Rate/Price" : "Rate/Price"}</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {groupedDocumentItems.map((group) => {
              const isServiceJob = Boolean(group.title);
              const jobTotal = group.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
              return [
                isServiceJob && (
                  <tr className="document-job-heading" key={`${group.id}-heading`}>
                    <td colSpan={4}>
                      <strong>{group.title}</strong>
                      {group.story && <p><span>Technician story:</span> {group.story}</p>}
                    </td>
                    <td><strong>{money(jobTotal)}</strong></td>
                  </tr>
                ),
                ...group.items.map((item) => (
                  <tr key={item.id} className={item.item_type === "discount" ? "document-discount-row" : item.item_type === "part" && isServiceJob ? "document-associated-part" : ""}>
                    <td>
                      {item.item_type === "discount" && <strong className="discount-applied-label">DISCOUNT APPLIED</strong>}
                      {item.description}
                    </td>
                    <td>{item.item_type.charAt(0).toUpperCase() + item.item_type.slice(1)}</td>
                    <td>{item.quantity}</td>
                    <td>{money(item.item_type === "discount" ? Math.abs(item.unit_price) : item.unit_price)}</td>
                    <td className={item.item_type === "discount" ? "discount-amount" : ""}>{money(item.quantity * item.unit_price)}</td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>

        <div className="document-bottom">
          <div className="document-notes">
            {ro.notes && (
              <>
                <h3>{isInvoice ? "Service notes" : "Notes"}</h3>
                <p>{ro.notes}</p>
              </>
            )}
          </div>
          <div className="document-totals">
            <div><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
            <div><span>Tax ({Number(ro.tax_rate).toFixed(3)}%)</span><strong>{money(tax)}</strong></div>
            <div className="grand-total"><span>{finalTotalLabel}</span><strong>{money(total)}</strong></div>
            {isInvoice && (
              <div className={`amount-due-row ${ro.paid ? "paid" : "unpaid"}`}>
                <span>{ro.paid ? "Balance" : "Amount due"}</span>
                <strong>{money(ro.paid ? 0 : total)}</strong>
              </div>
            )}
          </div>
        </div>

        {isEstimate && (
          <section className="document-terms estimate-terms">
            <strong>Estimate terms</strong>
            <p>This estimate is based on currently known conditions and listed work. Additional repairs require customer approval and may change the final invoice total.</p>
            <div className="signature-row">
              <span>Approved by: ______________________________</span>
              <span>Date: __________________</span>
            </div>
          </section>
        )}

        {isWorkOrder && (
          <section className="document-terms repair-order-terms">
            <strong>Work authorization</strong>
            <p>Customer authorizes Allegiant Auto Care to perform the work listed above and acknowledges that additional work requires further approval.</p>
            <div className="signature-row">
              <span>Authorized by: ____________________________</span>
              <span>Date: __________________</span>
            </div>
          </section>
        )}

        {isInvoice && (
          <footer className="document-footer">
            <strong>{ro.paid ? "PAID IN FULL" : "PAYMENT DUE UPON COMPLETION"}</strong>
            <p>{settings.invoice_footer}</p>
          </footer>
        )}
      </article>
    </section>
  );
}
