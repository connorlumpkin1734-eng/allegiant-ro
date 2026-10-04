"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { MultipointInspection } from "@/components/MultipointInspection";
import { supabase } from "@/lib/supabase";

type View = "dashboard" | "editor" | "customers" | "customer_profile" | "settings" | "document" | "inspection" | "reports";
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
  primary_color: string;
  accent_color: string;
  secondary_color: string;
  logo_path: string | null;
  team_features_enabled: boolean;
  techs_can_price: boolean;
  stripe_account_id: string | null;
  stripe_account_type: "express" | "standard" | null;
  stripe_onboarding_complete: boolean;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  // Manual, no-API payment method: customer pays the shop directly via Zelle, and a staff member
  // confirms receipt themselves. See request-zelle-payment.ts / confirm-zelle-payment.ts.
  zelle_recipient: string | null;
  // Platform billing: Connor charging this shop to use the software (separate from the shop's own
  // Stripe Connect account above, which is for THEIR customers' payments).
  subscription_status: "trialing" | "active" | "past_due" | "canceled" | "exempt";
  plan_price_cents: number | null;
  trial_ro_limit: number;
  trial_ro_created_count: number;
  subscription_current_period_end: string | null;
  // Set the moment Stripe first reports a failed charge; cleared on recovery. Drives the 7-day
  // read-only grace period — mirrors owner_can_write() in Postgres (see migration
  // 20261001_past_due_grace_period.sql).
  subscription_past_due_since: string | null;
  is_platform_admin: boolean;
};

type StaffRole = "technician" | "service_advisor";
type Team = { id: string; name: string };
type StaffMember = {
  id: string;
  auth_user_id: string | null;
  name: string;
  email: string;
  username: string | null;
  employee_id: string | null;
  role: StaffRole;
  team_id: string | null;
  can_view_all_work: boolean;
  is_admin: boolean;
  active: boolean;
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
  work_performed: string | null;
  internal_notes: string | null;
};

type EstimatePhoto = {
  id: string;
  repair_order_id: string;
  service_group_id: string;
  storage_path: string;
  caption: string | null;
  sort_order: number;
  created_at: string;
  signed_url?: string;
};

type EstimateVideo = {
  id: string;
  repair_order_id: string;
  service_group_id: string;
  storage_key: string;
  content_type: string | null;
  caption: string | null;
  sort_order: number;
  created_at: string;
  signed_url?: string;
};

type InvoiceOverrides = Record<string, { note: string; recorded_at: string; recorded_by: string }>;

type RepairOrder = {
  invoice_overrides?: InvoiceOverrides;
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
  completed_at: string | null;
  estimate_status?: "not_sent" | "sent" | "approved" | "partially_approved" | "declined";
  estimate_sent_at?: string | null;
  estimate_responded_at?: string | null;
  customers?: Customer | null;
  vehicles?: Vehicle | null;
  line_items?: LineItem[];
  latest_estimate_authorization?: EstimateAuthorization | null;
};

type EstimateAuthorization = {
  id: string;
  repair_order_id: string;
  status: "sent" | "approved" | "partially_approved" | "declined" | "superseded";
  line_decisions: Record<string, "approved" | "declined"> | null;
  approved_total: number | null;
  customer_name?: string | null;
  signature_data?: string | null;
  consent_accepted?: boolean | null;
  responded_at: string | null;
  sent_at: string;
  estimate_snapshot: {
    items?: Array<{
      description?: string;
      quantity?: number;
      unit_price?: number;
      taxable?: boolean;
      service_group_id?: string | null;
      service_group_title?: string | null;
      technician_story?: string | null;
    }>;
  };
};

type AuthorizationDecisionSummary = {
  approved: string[];
  declined: string[];
};

type DeclinedEstimateGroup = {
  id: string;
  title: string;
  recommendation: string;
  items: Array<{
    description: string;
    quantity: number;
    unit_price: number;
  }>;
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
  primary_color: "#2459a9",
  accent_color: "#b5222d",
  secondary_color: "#10264d",
  logo_path: null,
  team_features_enabled: false,
  techs_can_price: true,
  stripe_account_id: null,
  stripe_account_type: null,
  stripe_onboarding_complete: false,
  stripe_charges_enabled: false,
  stripe_payouts_enabled: false,
  zelle_recipient: null,
  subscription_status: "trialing",
  plan_price_cents: null,
  trial_ro_limit: 5,
  trial_ro_created_count: 0,
  subscription_current_period_end: null,
  subscription_past_due_since: null,
  is_platform_admin: false,
};

function logoPublicUrl(logoPath: string | null | undefined) {
  if (!logoPath) return null;
  const { data } = supabase.storage.from("shop-branding").getPublicUrl(logoPath);
  return data.publicUrl;
}

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

function extractVin(value: string): string | null {
  return value.toUpperCase().match(/[A-HJ-NPR-Z0-9]{17}/)?.[0] ?? null;
}

function statusLabel(status: RepairOrder["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function hasAuthorizationResponse(
  authorization: EstimateAuthorization | null | undefined
): authorization is EstimateAuthorization {
  return Boolean(
    authorization
      && ["approved", "partially_approved", "declined"].includes(authorization.status)
      && Object.keys(authorization.line_decisions ?? {}).length > 0
  );
}

function authorizedLineItems<T extends { service_group_id: string | null }>(
  items: T[],
  authorization: EstimateAuthorization | null | undefined,
  overrides: InvoiceOverrides = {}
): T[] {
  if (!hasAuthorizationResponse(authorization)) return items;
  const decisions = authorization.line_decisions ?? {};
  const hasApprovedService = Object.values(decisions).includes("approved") || items.some((item) => item.service_group_id && overrides[item.service_group_id]);
  return items.filter((item) =>
    item.service_group_id
      ? decisions[item.service_group_id] === "approved" || Boolean(overrides[item.service_group_id])
      : hasApprovedService
  );
}

function calculateLineItemTotals(
  items: Array<Pick<LineItem, "quantity" | "unit_price" | "taxable">>,
  taxRate: number
) {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const taxableSubtotal = items.reduce(
    (sum, item) => sum + (item.taxable ? item.quantity * item.unit_price : 0),
    0
  );
  const tax = Math.max(0, taxableSubtotal) * (taxRate / 100);
  return { subtotal, taxableSubtotal, tax, total: subtotal + tax };
}

function repairOrderTotal(ro: RepairOrder): number {
  const items = authorizedLineItems(ro.line_items ?? [], ro.latest_estimate_authorization, ro.invoice_overrides);
  return calculateLineItemTotals(items, Number(ro.tax_rate)).total;
}

function authorizationDecisionSummary(
  authorization: EstimateAuthorization | null | undefined
): AuthorizationDecisionSummary {
  const decisions = authorization?.line_decisions ?? {};
  const jobTitles = new Map<string, string>();

  for (const item of authorization?.estimate_snapshot?.items ?? []) {
    if (item.service_group_id && !jobTitles.has(item.service_group_id)) {
      jobTitles.set(item.service_group_id, item.service_group_title || "Service job");
    }
  }

  return {
    approved: [...jobTitles]
      .filter(([id]) => decisions[id] === "approved")
      .map(([, title]) => title),
    declined: [...jobTitles]
      .filter(([id]) => decisions[id] === "declined")
      .map(([, title]) => title),
  };
}

function compactDecisionTitles(titles: string[]): string {
  if (titles.length <= 2) return titles.join(", ");
  return `${titles.slice(0, 2).join(", ")} +${titles.length - 2} more`;
}

function declinedEstimateGroups(
  authorization: EstimateAuthorization | null | undefined
): DeclinedEstimateGroup[] {
  const decisions = authorization?.line_decisions ?? {};
  const groups = new Map<string, DeclinedEstimateGroup>();

  for (const item of authorization?.estimate_snapshot?.items ?? []) {
    const groupId = item.service_group_id;
    if (!groupId || decisions[groupId] !== "declined") continue;

    let group = groups.get(groupId);
    if (!group) {
      group = {
        id: groupId,
        title: item.service_group_title || "Recommended service",
        recommendation: item.technician_story || "",
        items: [],
      };
      groups.set(groupId, group);
    }

    group.items.push({
      description: item.description || "Service item",
      quantity: Number(item.quantity || 0),
      unit_price: Number(item.unit_price || 0),
    });
  }

  return [...groups.values()];
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
  technicianStory: string | null = null,
  workPerformed: string | null = null,
  internalNotes: string | null = null
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
      work_performed: workPerformed,
      internal_notes: internalNotes,
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
      work_performed: workPerformed,
      internal_notes: internalNotes,
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
    work_performed: workPerformed,
    internal_notes: internalNotes,
  };
}

export default function HomePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [platformAdminChecked, setPlatformAdminChecked] = useState(false);
  const [isPlatformAdminAccount, setIsPlatformAdminAccount] = useState(false);

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

  // A god-mode / platform-operator login is never tied to a shop. Check that FIRST, before any
  // shop data ever loads, so this kind of account can never end up auto-creating a blank shop
  // for itself (see RepairOrderApp's loadData) and never sees shop screens at all.
  useEffect(() => {
    if (!session) {
      setPlatformAdminChecked(false);
      setIsPlatformAdminAccount(false);
      return;
    }
    let cancelled = false;
    supabase
      .from("platform_admins")
      .select("id")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setIsPlatformAdminAccount(Boolean(data));
        setPlatformAdminChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (authLoading || (session && !platformAdminChecked)) {
    return <div className="center-screen">Loading Allegiant RO…</div>;
  }

  if (!session) {
    return <AuthScreen />;
  }

  if (isPlatformAdminAccount) {
    return <PlatformAdminOnlyApp />;
  }

  return <RepairOrderApp user={session.user} />;
}

// The entire screen for a god-mode / platform-operator login: no shop chrome, no work orders, no
// customers — just the cross-tenant admin panel and a way to sign out.
function PlatformAdminOnlyApp() {
  return (
    <div className="app-shell">
      <header className="topbar no-print">
        <span className="topbar-logo-text">Platform Admin</span>
        <nav />
        <button className="button secondary" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </header>
      <main className="main-area">
        <PlatformAdminPanel />
      </main>
    </div>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [identifier, setIdentifier] = useState(""); // shop owner's email (signup), or username/email (login, forgot)
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  // Lightweight, privacy-light visit counter for the god-mode traffic view: a random id generated
  // and stored in this browser's localStorage (never a name/email/account) so repeat visits from the
  // same browser can be told apart from new ones. Skipped entirely for a browser already tagged as
  // belonging to a paying shop (see RepairOrderApp), so those don't inflate "traffic."
  useEffect(() => {
    try {
      if (localStorage.getItem("arc_known_paying_shop") === "1") return;
      let visitorId = localStorage.getItem("arc_visitor_id");
      if (!visitorId) {
        visitorId = crypto.randomUUID();
        localStorage.setItem("arc_visitor_id", visitorId);
      }
      fetch("/.netlify/functions/track-visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId }),
      }).catch(() => {});
    } catch {
      // localStorage can be unavailable (private browsing, etc.) — just skip tracking silently.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Staff sign in with a username, not their real email. If what was typed isn't an email address,
  // look up the real email behind that username so Supabase Auth (which only knows emails) can be used.
  async function resolveEmail(value: string): Promise<string | null> {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.includes("@")) return trimmed;
    try {
      const response = await fetch("/.netlify/functions/resolve-username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed }),
      });
      if (!response.ok) return null;
      const body = await response.json() as { email?: string };
      return body.email || null;
    } catch {
      return null;
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    if (mode === "forgot") {
      const resolvedEmail = await resolveEmail(identifier);
      // Same message either way — don't reveal whether a username/email has an account.
      const genericMessage = "If that account exists, a password reset link is on its way. Check your inbox.";
      if (!resolvedEmail) {
        setMessage(genericMessage);
        setBusy(false);
        return;
      }
      const { error } = await supabase.auth.resetPasswordForEmail(resolvedEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setMessage(error ? error.message : genericMessage);
      setBusy(false);
      return;
    }

    if (mode === "signup") {
      const result = await supabase.auth.signUp({ email: identifier.trim(), password });
      if (result.error) {
        setMessage(result.error.message);
      } else if (!result.data.session) {
        setMessage("Account created. Check your email to confirm it, then sign in.");
      }
      setBusy(false);
      return;
    }

    // login
    const resolvedEmail = await resolveEmail(identifier);
    if (!resolvedEmail) {
      setMessage("Invalid login credentials.");
      setBusy(false);
      return;
    }
    const result = await supabase.auth.signInWithPassword({ email: resolvedEmail, password });
    if (result.error) setMessage(result.error.message);
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
            {mode === "signup" ? "Email" : "Username or email"}
            <input
              type={mode === "signup" ? "email" : "text"}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              required
              autoComplete={mode === "signup" ? "email" : "username"}
            />
          </label>
          {mode !== "forgot" && (
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
          )}
          {mode === "signup" && (
            <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>
              Try it free — no card required. New shops can create up to 5 repair orders at no cost;
              subscribing afterward unlocks unlimited repair orders and payment processing.
            </p>
          )}
          {message && <div className="notice">{message}</div>}
          <button className="button primary" disabled={busy} type="submit">
            {busy
              ? "Working…"
              : mode === "login"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : "Send reset link"}
          </button>
        </form>
        {mode === "login" && (
          <button
            className="button link-button"
            type="button"
            onClick={() => {
              setMode("forgot");
              setMessage("");
            }}
            style={{ marginTop: 4 }}
          >
            Forgot password?
          </button>
        )}
        <button
          className="button link-button"
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setMessage("");
          }}
        >
          {mode === "login" ? "Create account" : "Back to sign in"}
        </button>
        {mode === "signup" && (
          <p className="muted" style={{ fontSize: 12, marginTop: 10, textAlign: "center" }}>
            By creating an account, you agree to our{" "}
            <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> and{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
          </p>
        )}
      </section>
      <footer style={{ textAlign: "center", marginTop: 18, fontSize: 12 }}>
        <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: "#8493a6" }}>Terms</a>
        {" · "}
        <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: "#8493a6" }}>Privacy</a>
      </footer>
    </main>
  );
}

function ChangePasswordModal({
  onClose,
  forced,
  onSuccess,
}: {
  onClose: () => void;
  forced?: boolean;
  onSuccess?: () => Promise<void> | void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    if (password.length < 6) {
      setMessage("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setMessage("Passwords don't match.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      setMessage(error.message);
      return;
    }
    if (onSuccess) await onSuccess();
    setBusy(false);
    setDone(true);
  }

  return (
    <div className="vin-scanner-backdrop" role="dialog" aria-modal="true" aria-label="Change password">
      <div className="vin-scanner-modal" style={{ maxWidth: 420 }}>
        <h2 style={{ marginTop: 0 }}>{forced ? "Set your password" : "Change password"}</h2>
        {forced && !done && (
          <p className="muted" style={{ marginTop: -6 }}>
            You&apos;re signing in with a temporary password. Set your own before continuing.
          </p>
        )}
        {done ? (
          <>
            <p>Your password has been updated.</p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="button primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <form onSubmit={submit} className="stack">
            <label>
              New password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                required
                autoComplete="new-password"
              />
            </label>
            <label>
              Confirm new password
              <input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                minLength={6}
                required
                autoComplete="new-password"
              />
            </label>
            {message && <div className="notice">{message}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {!forced && <button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button>}
              <button type="submit" className="button primary" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// Mirrors the DB's owner_can_write() RLS check (see migration
// 20261001_past_due_grace_period.sql), purely for UX (friendly messaging/disabled buttons) — the
// real enforcement lives in Postgres and doesn't depend on this being correct. Shared by
// RepairOrderApp and the work-order editor so the 7-day past_due grace period only has one place
// to get right on the client.
function shopCanWrite(settings: Settings): boolean {
  if (settings.subscription_status === "active" || settings.subscription_status === "exempt") return true;
  if (settings.subscription_status === "trialing") return settings.trial_ro_created_count < settings.trial_ro_limit;
  if (settings.subscription_status === "past_due") {
    return Boolean(
      settings.subscription_past_due_since
        && Date.now() - new Date(settings.subscription_past_due_since).getTime() < 7 * 24 * 60 * 60 * 1000
    );
  }
  return false;
}

// Days left in the past_due grace period (null when not applicable). Rounds up so "a few hours
// left" still reads as "1 day left" rather than "0 days left".
function pastDueDaysLeft(settings: Settings): number | null {
  if (settings.subscription_status !== "past_due" || !settings.subscription_past_due_since) return null;
  const elapsedMs = Date.now() - new Date(settings.subscription_past_due_since).getTime();
  const remainingMs = 7 * 24 * 60 * 60 * 1000 - elapsedMs;
  return Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
}

type CurrentStaff = {
  id: string;
  owner_id: string;
  role: StaffRole;
  can_view_all_work: boolean;
  is_admin: boolean;
  must_change_password: boolean;
};

function RepairOrderApp({ user }: { user: User }) {
  const [view, setView] = useState<View>("dashboard");
  const [currentStaff, setCurrentStaff] = useState<CurrentStaff | null>(null);
  const [staffResolved, setStaffResolved] = useState(false);
  const isOwner = !currentStaff;
  const isAdminAccess = isOwner || Boolean(currentStaff?.is_admin);
  const isTechnicianOnly = Boolean(currentStaff) && currentStaff!.role === "technician" && !currentStaff!.is_admin;
  const ownerId = currentStaff?.owner_id ?? user.id;
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const canWrite = shopCanWrite(settings);

  // Tag this browser once we know it belongs to a paying shop, so future landing-page visits from it
  // don't count toward the god-mode traffic counter (that counter is meant to track prospective
  // traffic, not an existing customer's browser reloading the login screen).
  useEffect(() => {
    if (settings.subscription_status !== "active" && settings.subscription_status !== "exempt") return;
    try {
      localStorage.setItem("arc_known_paying_shop", "1");
    } catch {
      // Ignore — this is purely a nice-to-have for the traffic counter.
    }
  }, [settings.subscription_status]);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [repairOrders, setRepairOrders] = useState<RepairOrder[]>([]);
  const [selectedRo, setSelectedRo] = useState<RepairOrder | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [editingRo, setEditingRo] = useState<RepairOrder | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const [newContext, setNewContext] = useState<{ customerId: string; vehicleId: string }>({ customerId: "", vehicleId: "" });
  const [documentMode, setDocumentMode] = useState<DocumentMode>("work_order");
  const [documentReturnView, setDocumentReturnView] = useState<"dashboard" | "customer_profile" | "editor">("dashboard");
  const [inspectionReturnView, setInspectionReturnView] = useState<"dashboard" | "customer_profile" | "editor" | "document">("dashboard");
  const [editorTab, setEditorTab] = useState<WorkspaceTab>("work_order");
  const [editorReturnView, setEditorReturnView] = useState<"dashboard" | "customer_profile">("dashboard");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [stripeOAuthCode, setStripeOAuthCode] = useState<string | null>(null);
  const [stripeReturnPending, setStripeReturnPending] = useState(false);

  async function loadData(showLoading = true) {
    if (showLoading) setLoading(true);
    setError("");

    const [settingsResult, customersResult, vehiclesResult, roResult, authorizationsResult] = await Promise.all([
      supabase.from("settings").select("*").maybeSingle(),
      supabase.from("customers").select("*").order("name"),
      supabase.from("vehicles").select("*").order("year", { ascending: false }),
      supabase
        .from("repair_orders")
        .select("*, customers(*), vehicles(*), line_items(*)")
        .order("created_at", { ascending: false }),
      supabase
        .from("estimate_authorizations")
        .select("id, repair_order_id, status, line_decisions, approved_total, responded_at, sent_at, estimate_snapshot")
        .order("sent_at", { ascending: false }),
    ]);

    const firstError =
      settingsResult.error || customersResult.error || vehiclesResult.error || roResult.error || authorizationsResult.error;

    if (firstError) {
      setError(firstError.message);
      if (showLoading) setLoading(false);
      return;
    }

    let loadedSettings = settingsResult.data as Settings | null;
    if (!loadedSettings && isOwner) {
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

    const latestAuthorizationByRo = new Map<string, EstimateAuthorization>();
    for (const authorization of (authorizationsResult.data ?? []) as EstimateAuthorization[]) {
      if (!latestAuthorizationByRo.has(authorization.repair_order_id)) latestAuthorizationByRo.set(authorization.repair_order_id, authorization);
    }
    const loadedRos = ((roResult.data ?? []) as RepairOrder[]).map((ro) => ({
      ...ro,
      line_items: [...(ro.line_items ?? [])].sort((a, b) => a.sort_order - b.sort_order),
      latest_estimate_authorization: latestAuthorizationByRo.get(ro.id) ?? null,
    }));

    setSettings(loadedSettings ?? defaultSettings);
    setCustomers((customersResult.data ?? []) as Customer[]);
    setVehicles((vehiclesResult.data ?? []) as Vehicle[]);
    setRepairOrders(loadedRos);

    if (selectedCustomer) {
      const refreshed = ((customersResult.data ?? []) as Customer[]).find((customer) => customer.id === selectedCustomer.id);
      setSelectedCustomer(refreshed ?? null);
    }

    if (showLoading) setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("staff")
      .select("id, owner_id, role, can_view_all_work, is_admin, must_change_password")
      .eq("auth_user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const staffRow = (data as CurrentStaff | null) ?? null;
        setCurrentStaff(staffRow);
        setStaffResolved(true);
        if (staffRow?.must_change_password) setShowPasswordChange(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  useEffect(() => {
    // A staff login should never land on an owner-only screen — bounce back to the dashboard.
    if (staffResolved && !isAdminAccess && view === "settings") {
      setView("dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffResolved, isAdminAccess, view]);

  useEffect(() => {
    // Landing back here after Stripe onboarding (Express account link, or Standard OAuth) —
    // jump straight to Settings so the Payments panel can pick up where it left off, and strip
    // the query string so a page refresh doesn't try to redeem the same one-time code twice.
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const stripeOAuth = params.get("stripe_oauth");
    const stripeReturn = params.get("stripe");
    const billingReturn = params.get("billing");
    if (stripeOAuth && code) {
      setStripeOAuthCode(code);
      setView("settings");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (stripeReturn === "return" || stripeReturn === "refresh") {
      setStripeReturnPending(true);
      setView("settings");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (billingReturn === "success" || billingReturn === "canceled") {
      // The subscription webhook usually beats the redirect back here, but re-load once more in
      // case it hasn't — the window-focus refresh below would otherwise be the only backstop.
      setView("settings");
      window.history.replaceState({}, "", window.location.pathname);
      window.setTimeout(() => void loadData(false), 1500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--blue", settings.primary_color);
    root.style.setProperty("--red", settings.accent_color);
    root.style.setProperty("--navy", settings.secondary_color);
  }, [settings.primary_color, settings.accent_color, settings.secondary_color]);

  useEffect(() => {
    const refreshWhenReturning = () => {
      if (document.visibilityState === "visible" && view !== "editor") void loadData(false);
    };
    window.addEventListener("focus", refreshWhenReturning);
    document.addEventListener("visibilitychange", refreshWhenReturning);
    return () => {
      window.removeEventListener("focus", refreshWhenReturning);
      document.removeEventListener("visibilitychange", refreshWhenReturning);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  async function openDocument(
    id: string,
    mode: DocumentMode = "work_order",
    returnView: "dashboard" | "customer_profile" | "editor" = "dashboard"
  ) {
    setError("");
    const [roResult, authorizationResult] = await Promise.all([
      supabase
        .from("repair_orders")
        .select("*, customers(*), vehicles(*), line_items(*)")
        .eq("id", id)
        .single(),
      supabase
        .from("estimate_authorizations")
        .select("id, repair_order_id, status, line_decisions, approved_total, customer_name, signature_data, consent_accepted, responded_at, sent_at, estimate_snapshot")
        .eq("repair_order_id", id)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (roResult.error || authorizationResult.error) {
      setError((roResult.error || authorizationResult.error)?.message || "Could not open the repair order.");
      return;
    }

    const loaded = roResult.data as RepairOrder;
    loaded.line_items = [...(loaded.line_items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    loaded.latest_estimate_authorization = authorizationResult.data as EstimateAuthorization | null;
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
    const [roResult, authorizationResult] = await Promise.all([
      supabase
        .from("repair_orders")
        .select("*, customers(*), vehicles(*), line_items(*)")
        .eq("id", id)
        .single(),
      supabase
        .from("estimate_authorizations")
        .select("id, repair_order_id, status, line_decisions, approved_total, customer_name, responded_at, sent_at, estimate_snapshot")
        .eq("repair_order_id", id)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (roResult.error || authorizationResult.error) {
      setError((roResult.error || authorizationResult.error)?.message || "Could not open the repair order.");
      return;
    }

    const loaded = roResult.data as RepairOrder;
    loaded.line_items = [...(loaded.line_items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    loaded.latest_estimate_authorization = authorizationResult.data as EstimateAuthorization | null;
    setEditingRo(loaded);
    setEditorVersion((current) => current + 1);
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
    setEditorVersion((current) => current + 1);
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
    if (!canWrite) {
      setError("This shop's access is read-only right now — go to Settings to resolve billing before archiving work orders.");
      return;
    }
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
    if (!canWrite) {
      setError("This shop's access is read-only right now — go to Settings to resolve billing before deleting work orders.");
      return;
    }
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
    if (!canWrite) {
      setError("This shop's access is read-only right now — go to Settings to resolve billing before archiving customers.");
      return;
    }
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
    if (!canWrite) {
      setError("This shop's access is read-only right now — go to Settings to resolve billing before deleting customers.");
      return;
    }
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
          {logoPublicUrl(settings.logo_path) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="topbar-logo"
              src={logoPublicUrl(settings.logo_path) ?? undefined}
              alt={settings.business_name}
            />
          ) : (
            <span className="topbar-logo-text">{settings.business_name}</span>
          )}
        </button>
        <nav>
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>
            Work Orders
          </button>
          {!isTechnicianOnly && <button onClick={() => startNew()}>New Work Order</button>}
          {!isTechnicianOnly && (
            <button className={view === "customers" || view === "customer_profile" ? "active" : ""} onClick={() => setView("customers")}>
              Customers
            </button>
          )}
          {isAdminAccess && (
            <button className={view === "reports" ? "active" : ""} onClick={() => setView("reports")}>
              Reports
            </button>
          )}
          {isAdminAccess && (
            <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
              Settings
            </button>
          )}
        </nav>
        <button className="button secondary" onClick={() => setShowPasswordChange(true)}>
          Change password
        </button>
        <button className="button secondary" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </header>
      {showPasswordChange && (
        <ChangePasswordModal
          forced={Boolean(currentStaff?.must_change_password)}
          onClose={() => setShowPasswordChange(false)}
          onSuccess={async () => {
            if (currentStaff?.must_change_password) {
              await supabase.from("staff").update({ must_change_password: false }).eq("id", currentStaff.id);
              setCurrentStaff({ ...currentStaff, must_change_password: false });
            }
          }}
        />
      )}

      <main className="main-area">
        {error && <div className="error-banner no-print">{error}</div>}
        {canWrite && settings.subscription_status === "past_due" && !loading && (
          <div className="billing-banner no-print" style={{ background: "#fff4e5", borderColor: "#f0b429", color: "#7a4a00" }}>
            <span>
              We couldn&apos;t charge this shop&apos;s payment method. {pastDueDaysLeft(settings) ?? 7} day{pastDueDaysLeft(settings) === 1 ? "" : "s"} left to fix it before the account goes read-only — existing work stays viewable, but creating or editing will pause.
            </span>
            {isOwner ? (
              <button className="button small primary" onClick={() => setView("settings")}>
                Fix billing
              </button>
            ) : (
              <span className="muted" style={{ fontSize: 13 }}>Ask the shop owner to update billing.</span>
            )}
          </div>
        )}
        {!canWrite && !loading && (
          <div className="billing-banner no-print">
            <span>
              {settings.subscription_status === "trialing"
                ? `You've exceeded your free trial limit of ${settings.trial_ro_limit} repair orders. Existing work orders are still viewable, but creating or editing anything is paused until this shop subscribes.`
                : settings.subscription_status === "past_due"
                  ? "This shop's payment method still hasn't been fixed, so the account is now read-only. Existing work orders are still viewable, but creating or editing anything is paused until billing is resolved."
                  : "This shop's subscription needs attention. Existing work orders are still viewable, but creating or editing anything is paused until it's resolved."}
            </span>
            {isOwner ? (
              <button className="button small primary" onClick={() => setView("settings")}>
                Go to Billing
              </button>
            ) : (
              <span className="muted" style={{ fontSize: 13 }}>Ask the shop owner to update billing.</span>
            )}
          </div>
        )}
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
            onInspection={(id) => openInspection(id, "dashboard")}
            onOpenCustomer={openCustomer}
            onStatusChange={updateRoStatus}
            onPaidChange={updateRoPaidStatus}
            canCreate={!isTechnicianOnly}
          />
        ) : view === "editor" ? (
          <RepairOrderEditor
            key={`${editingRo?.id ?? "new-repair-order"}-${editorVersion}`}
            user={user}
            ownerId={ownerId}
            isTechnician={isTechnicianOnly}
            settings={settings}
            customers={customers}
            vehicles={vehicles}
            initialRo={editingRo}
            initialCustomerId={newContext.customerId}
            initialVehicleId={newContext.vehicleId}
            initialTab={editorTab}
            onInspection={editingRo ? () => openInspection(editingRo.id, "editor") : undefined}
            onCancel={returnFromEditor}
            onDelete={editingRo && !isTechnicianOnly ? () => deleteRo(editingRo) : undefined}
            onSaved={async (id, tab, previewMode) => {
              setEditorTab(tab);
              await loadData(false);
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
        ) : view === "reports" && isAdminAccess ? (
          <ReportsPanel repairOrders={repairOrders} />
        ) : view === "settings" && isAdminAccess ? (
          <SettingsPanel
            user={user}
            ownerId={ownerId}
            isOwner={isOwner}
            initialSettings={settings}
            pendingStripeOAuthCode={stripeOAuthCode}
            onStripeOAuthCodeHandled={() => setStripeOAuthCode(null)}
            stripeReturnPending={stripeReturnPending}
            onStripeReturnHandled={() => setStripeReturnPending(false)}
            onSaved={async () => {
              await loadData();
              setView("dashboard");
            }}
            onStripeStatusChanged={() => void loadData(false)}
          />
        ) : view === "inspection" && selectedRo ? (
          <MultipointInspection ro={selectedRo} userId={ownerId} onBack={returnFromInspection} />
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
            onPaid={() => refreshCurrentDocument(selectedRo.id)}
          />
        ) : null}
      </main>
    </div>
  );
}

type MonthlyReportRow = {
  monthKey: string;
  monthLabel: string;
  jobsCompleted: number;
  revenue: number;
  laborRevenue: number;
  partsProfit: number;
  outstanding: number;
};

function monthKeyOf(dateString: string): string {
  return dateString.slice(0, 7); // "YYYY-MM"
}

function monthLabelOf(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function buildMonthlyReport(repairOrders: RepairOrder[]): MonthlyReportRow[] {
  const rows = new Map<string, MonthlyReportRow>();

  const getRow = (monthKey: string) => {
    let row = rows.get(monthKey);
    if (!row) {
      row = { monthKey, monthLabel: monthLabelOf(monthKey), jobsCompleted: 0, revenue: 0, laborRevenue: 0, partsProfit: 0, outstanding: 0 };
      rows.set(monthKey, row);
    }
    return row;
  };

  for (const ro of repairOrders) {
    if (ro.status === "voided") continue;

    // Jobs completed: counted in the month the job was actually finished.
    if (ro.completed_at) {
      getRow(monthKeyOf(ro.completed_at)).jobsCompleted += 1;
    }

    const items = authorizedLineItems(ro.line_items ?? [], ro.latest_estimate_authorization, ro.invoice_overrides);

    // Revenue only counts once the customer has actually paid, attributed to the month they paid.
    if (ro.paid && ro.paid_at) {
      const row = getRow(monthKeyOf(ro.paid_at));
      row.revenue += calculateLineItemTotals(items, Number(ro.tax_rate)).total;
      row.laborRevenue += items.reduce((sum, item) => (item.item_type === "labor" ? sum + item.quantity * item.unit_price : sum), 0);
      row.partsProfit += items.reduce(
        (sum, item) => (item.item_type === "part" ? sum + item.quantity * (item.unit_price - (item.unit_cost ?? 0)) : sum),
        0
      );
    }

    // Outstanding: work that's done but not yet paid — shown against the month it was completed.
    if (ro.status === "completed" && !ro.paid) {
      const monthKey = ro.completed_at ? monthKeyOf(ro.completed_at) : "unknown";
      getRow(monthKey).outstanding += calculateLineItemTotals(items, Number(ro.tax_rate)).total;
    }
  }

  return [...rows.values()].sort((a, b) => (a.monthKey < b.monthKey ? 1 : -1));
}

function ReportsPanel({ repairOrders }: { repairOrders: RepairOrder[] }) {
  const rows = useMemo(() => buildMonthlyReport(repairOrders), [repairOrders]);
  const totalOutstanding = rows.reduce((sum, row) => sum + row.outstanding, 0);

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Reports</h2>
      <p className="muted" style={{ marginTop: -8, marginBottom: 20 }}>
        Revenue and parts profit count once an invoice is marked paid, shown in the month it was paid. Jobs completed and
        outstanding balances are shown in the month a job was marked completed.
      </p>

      <div className="stat-tiles" style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <div className="panel" style={{ flex: "1 1 200px" }}>
          <div className="muted">Total outstanding (unpaid, completed work)</div>
          <div style={{ fontSize: 28, fontWeight: 600 }}>{money(totalOutstanding)}</div>
        </div>
      </div>

      {!rows.length ? (
        <div className="empty-state">No completed or paid work orders yet — reports will fill in as jobs are finished and paid.</div>
      ) : (
        <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>Jobs completed</th>
              <th>Revenue (paid)</th>
              <th>Labor revenue</th>
              <th>Parts profit (markup)</th>
              <th>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.monthKey}>
                <td>{row.monthLabel}</td>
                <td>{row.jobsCompleted}</td>
                <td>{money(row.revenue)}</td>
                <td>{money(row.laborRevenue)}</td>
                <td>{money(row.partsProfit)}</td>
                <td>{row.outstanding ? money(row.outstanding) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

function Dashboard({
  repairOrders,
  onNew,
  onOpen,
  onInspection,
  onOpenCustomer,
  onStatusChange,
  onPaidChange,
  canCreate = true,
}: {
  repairOrders: RepairOrder[];
  onNew: () => void;
  onOpen: (id: string, mode: DocumentMode) => void;
  onInspection: (id: string) => void;
  onOpenCustomer: (customer: Customer) => void;
  onStatusChange: (ro: RepairOrder, status: "open" | "completed") => Promise<void>;
  onPaidChange: (ro: RepairOrder, paid: boolean) => Promise<void>;
  canCreate?: boolean;
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

  const currentRecords = repairOrders.filter((ro) => !ro.archived_at);
  const archivedCount = repairOrders.length - currentRecords.length;
  const openCount = currentRecords.filter((ro) => ro.status === "open").length;
  const unpaidCount = currentRecords.filter(
    (ro) => ro.status === "completed" && !ro.paid
  ).length;
  const activeCount = openCount + unpaidCount;

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Work Orders</h1>
          <p>One job record. Print it as an estimate, use it as the shop work order, and issue the final invoice.</p>
        </div>
        {canCreate && (
          <button className="button primary" onClick={onNew}>
            + New Work Order
          </button>
        )}
      </div>

      <div className="summary-grid">
        <div className="summary-card">
          <span>Active work orders</span>
          <strong>{activeCount}</strong>
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
                <th>Estimate</th>
                <th>Invoice</th>
                <th>Billable total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ro) => {
                const authorization = ro.latest_estimate_authorization;
                const displayedEstimateStatus = authorization && authorization.status !== "superseded" ? authorization.status : ro.estimate_status ?? "not_sent";
                const decisionSummary = authorizationDecisionSummary(authorization);
                return (
                <tr key={ro.id} className={ro.archived_at ? "archived-row" : ""}>
                  <td className="ro-number"><button className="table-link ro-link" onClick={() => onOpen(ro.id, "work_order")}>#{padRo(ro.ro_number)}</button></td>
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
                      {ro.archived_at && <span className="badge archived">Archived</span>}
                    </div>
                  </td>
                  <td>
                    <div className="estimate-dashboard-status">
                    <span className={`badge estimate-${displayedEstimateStatus}`}>
                      {displayedEstimateStatus === "sent"
                        ? "Sent"
                        : displayedEstimateStatus === "approved"
                          ? "Approved"
                          : displayedEstimateStatus === "partially_approved"
                            ? "Partial"
                          : displayedEstimateStatus === "declined"
                            ? "Declined"
                            : "Not sent"}
                    </span>
                    {decisionSummary.approved.length > 0 && (
                      <div className="estimate-decision approved" title={decisionSummary.approved.join("\n")}>
                        <strong>✓ Approved · {money(Number(authorization?.approved_total || 0))}</strong>
                        <small>{compactDecisionTitles(decisionSummary.approved)}</small>
                      </div>
                    )}
                    {decisionSummary.declined.length > 0 && (
                      <div className="estimate-decision declined" title={decisionSummary.declined.join("\n")}>
                        <strong>✕ Declined</strong>
                        <small>{compactDecisionTitles(decisionSummary.declined)}</small>
                      </div>
                    )}
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
                  </td>
                </tr>
              );})}
              {!filtered.length && (
                <tr>
                  <td colSpan={9} className="empty-state">
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
  ownerId,
  isTechnician,
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
  onDelete,
}: {
  user: User;
  ownerId: string;
  isTechnician: boolean;
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
  onDelete?: () => void;
}) {
  const canWrite = shopCanWrite(settings);
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
  const [invoiceOverrides, setInvoiceOverrides] = useState<InvoiceOverrides>(initialRo?.invoice_overrides ?? {});
  const [finalEditConfirmed, setFinalEditConfirmed] = useState(false);
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
  const vinPhotoRef = useRef<HTMLInputElement>(null);
  const vinVideoRef = useRef<HTMLVideoElement>(null);
  const [vinScannerOpen, setVinScannerOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(initialTab);
  // Technicians can price parts (if the shop allows it) but must never see or edit labor rate,
  // parts markup/cost, or shop profit figures — and can't restructure the RO (no adding
  // service jobs/fees/discounts/labor lines, no removing or deleting anything).
  const hideCostAndMargin = isTechnician;
  const partPriceEditable = !isTechnician || settings.techs_can_price;
  const canAddPartLine = !isTechnician || settings.techs_can_price;
  const canRestructureRo = !isTechnician;

  useEffect(() => {
    if (!vinScannerOpen) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stream: MediaStream | undefined;
    let worker: { recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> } | undefined;

    async function startScanner() {
      setVinBusy(true);
      setMessage("Point the camera at the VIN. It will capture automatically when clear.");
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Live camera scanning is not supported by this browser. Use Take VIN photo instead.");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        const video = vinVideoRef.current;
        if (!video || cancelled) return;
        video.srcObject = stream;
        await video.play();
        const { createWorker } = await import("tesseract.js");
        worker = await createWorker("eng");

        const scanFrame = async () => {
          if (cancelled || !video.videoWidth || !worker) return;
          const canvas = document.createElement("canvas");
          const scale = Math.min(1, 1280 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
          let vin: string | null = null;
          const BarcodeDetectorClass = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
          if (BarcodeDetectorClass) {
            const codes = await new BarcodeDetectorClass({ formats: ["code_39", "code_128", "qr_code"] }).detect(canvas);
            vin = extractVin(codes.map((code) => code.rawValue).join(" "));
          }
          if (!vin) vin = extractVin((await worker.recognize(canvas)).data.text);
          if (vin && !cancelled) {
            if (window.confirm(`VIN captured as ${vin}. Use and decode this VIN?`)) {
              setVehicleForm((current) => ({ ...current, vin }));
              await decodeVin(vin);
            } else {
              setMessage("VIN capture canceled. Nothing was changed.");
            }
            setVinScannerOpen(false);
            return;
          }
          timer = setTimeout(() => void scanFrame(), 900);
        };
        await scanFrame();
      } catch (caught) {
        setMessage(caught instanceof Error ? caught.message : "The live VIN scanner could not start.");
        setVinScannerOpen(false);
      }
    }

    void startScanner();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      if (worker) void worker.terminate();
      setVinBusy(false);
    };
    // The scanner intentionally owns its camera/worker lifecycle only while the modal is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vinScannerOpen]);

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

  async function emailInvoice() {
    if (!initialRo) return;
    if (!customerForm.email.trim()) {
      setMessage("Add the customer's email address before sending the invoice.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Your session expired. Sign in again before sending.");

      const response = await fetch("/.netlify/functions/send-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ repairOrderId: initialRo.id }),
      });
      const body = await response.json() as { error?: string; message?: string; payNowIncluded?: boolean };
      if (!response.ok) throw new Error(body.error || "The invoice could not be emailed.");
      setMessage(body.message || `Invoice emailed to ${customerForm.email.trim()}.`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "The invoice could not be emailed.");
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
    return calculateLineItemTotals(items, taxRate);
  }, [items, taxRate]);

  const currentAuthorization = initialRo?.latest_estimate_authorization;
  const currentDecisions = currentAuthorization?.line_decisions ?? {};
  const hasCustomerAuthorizationResponse = hasAuthorizationResponse(currentAuthorization);
  const currentDecisionSummary = useMemo(
    () => authorizationDecisionSummary(currentAuthorization),
    [currentAuthorization]
  );
  const invoiceItems = useMemo(
    () => authorizedLineItems(items, currentAuthorization, invoiceOverrides),
    [items, currentAuthorization, invoiceOverrides]
  );
  const invoiceTotals = useMemo(
    () => calculateLineItemTotals(invoiceItems, taxRate),
    [invoiceItems, taxRate]
  );
  const displayedTotals = workspaceTab === "invoice" ? invoiceTotals : totals;
  const authorizationOverage = hasCustomerAuthorizationResponse
    ? invoiceTotals.total - Number(currentAuthorization?.approved_total || 0)
    : 0;

  const profitSummary = useMemo(() => {
    const revenue = invoiceItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
    const cost = invoiceItems.reduce((sum, item) => sum + (item.item_type === "part" ? item.quantity * Number(item.unit_cost || 0) : 0), 0);
    const profit = revenue - cost;
    return { revenue, cost, profit, margin: revenue !== 0 ? (profit / revenue) * 100 : 0, usesAuthorization: hasCustomerAuthorizationResponse };
  }, [hasCustomerAuthorizationResponse, invoiceItems]);

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
        groupedItem?.technician_story ?? null,
        groupedItem?.work_performed ?? null,
        groupedItem?.internal_notes ?? null
      )];
    });
  }

  function overrideInvoiceJob(groupId: string) {
    if (!window.confirm("Override the estimate decision and include this job on the final invoice? Only continue if the customer separately authorized this work. The original signed estimate will be preserved.")) return;
    const note = window.prompt("Record the additional authorization (this note prints on the invoice; for example: customer approved by text on Sept 19):");
    if (!note?.trim()) return;
    setInvoiceOverrides((current) => ({ ...current, [groupId]: {
      note: note.trim(), recorded_at: new Date().toISOString(), recorded_by: user.id,
    } }));
    setMessage("Additional authorization recorded. Save Changes to update the invoice.");
  }

  function addServiceJob() {
    const groupId = crypto.randomUUID();
    setItems((current) => [
      ...current,
      emptyLine("labor", settings, current.length, groupId, "New Service Job", ""),
    ]);
  }

  function updateServiceJob(groupId: string, field: "service_group_title" | "technician_story" | "work_performed" | "internal_notes", value: string) {
    setItems((current) => current.map((item) =>
      item.service_group_id === groupId ? { ...item, [field]: value } : item
    ));
  }

  async function deleteServiceJob(groupId: string) {
    if (!window.confirm("Delete this service job and its attached photos?")) return;
    if (initialRo) {
      const { data } = await supabase.from("estimate_photos").select("storage_path")
        .eq("repair_order_id", initialRo.id).eq("service_group_id", groupId);
      const paths = (data ?? []).map((photo) => photo.storage_path as string);
      if (paths.length) await supabase.storage.from("estimate-photos").remove(paths);
      await supabase.from("estimate_photos").delete().eq("repair_order_id", initialRo.id).eq("service_group_id", groupId);
    }
    setItems((current) => current.filter((item) => item.service_group_id !== groupId));
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
            item.technician_story,
            item.work_performed,
            item.internal_notes
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

  async function decodeVin(vinOverride?: string) {
    const vin = (vinOverride ?? vehicleForm.vin).trim().toUpperCase();
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

  async function scanVinPhoto(file?: File) {
    if (!file) return;
    setVinBusy(true);
    setMessage("Reading VIN from photo…");
    try {
      let detected = "";
      const BarcodeDetectorClass = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => { detect: (source: ImageBitmap) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
      if (BarcodeDetectorClass) {
        const bitmap = await createImageBitmap(file);
        const codes = await new BarcodeDetectorClass({ formats: ["code_39", "code_128", "qr_code"] }).detect(bitmap);
        bitmap.close();
        detected = codes.map((code) => code.rawValue).join(" ");
      }
      if (!/[A-HJ-NPR-Z0-9]{17}/i.test(detected)) {
        const { createWorker } = await import("tesseract.js");
        const worker = await createWorker("eng");
        const result = await worker.recognize(file);
        await worker.terminate();
        detected = result.data.text;
      }
      const vin = extractVin(detected);
      if (!vin) throw new Error("I couldn't find a clear 17-character VIN. Try a closer, straight-on photo with good light.");
      if (!window.confirm(`VIN read as ${vin}. Use and decode this VIN?`)) {
        setMessage("VIN scan canceled. Nothing was changed.");
        return;
      }
      setVehicleForm((current) => ({ ...current, vin }));
      await decodeVin(vin);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "VIN photo could not be read.");
    } finally {
      setVinBusy(false);
      if (vinPhotoRef.current) vinPhotoRef.current.value = "";
    }
  }

  async function save(previewMode?: DocumentMode) {
    if (!canWrite) {
      setMessage(
        initialRo
          ? "This shop's access is read-only right now — go to Settings to resolve billing before saving changes."
          : "You've used all this shop's free repair orders. Go to Settings → Billing to subscribe and keep creating new ones."
      );
      return;
    }
    if ((initialRo?.status === "completed" || initialRo?.paid) && !finalEditConfirmed) {
      if (!window.confirm("Override this final invoice and save changes? This updates its charges and totals. The original customer estimate approval will remain unchanged.")) return;
      setFinalEditConfirmed(true);
    }
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
        owner_id: ownerId,
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
        owner_id: ownerId,
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
        owner_id: ownerId,
        customer_id: customerId,
        vehicle_id: vehicleId,
        document_type: "repair_order" as DocumentType,
        ...(initialRo?.invoice_overrides !== undefined || Object.keys(invoiceOverrides).length ? { invoice_overrides: invoiceOverrides } : {}),
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
      } else {
        const { data, error } = await supabase.from("repair_orders").insert(roPayload).select("id").single();
        if (error) throw error;
        roId = data.id as string;
      }

      // Upsert by id (each line already has a stable client-generated uuid, whether it's an
      // existing DB row or a brand-new one) instead of delete-all-then-reinsert. This keeps ids
      // stable across saves, and it's required for technician saves specifically: technicians
      // have no delete permission on line_items, so a blanket delete would silently no-op and
      // the old rows would get duplicated by the reinsert. Only explicitly removed lines are
      // deleted below, which technician-driven saves never have (the UI never lets a technician
      // remove a line), so this never needs a delete grant for them.
      const existingLineIds = new Set((initialRo?.line_items ?? []).map((entry) => entry.id));
      const currentLineIds = new Set(items.map((entry) => entry.id));
      const removedLineIds = [...existingLineIds].filter((id) => !currentLineIds.has(id));

      const linePayload = items.map((item, index) => ({
        id: item.id,
        owner_id: ownerId,
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
        work_performed: valueOrNull(item.work_performed ?? ""),
        internal_notes: valueOrNull(item.internal_notes ?? ""),
      }));

      const { error: lineError } = await supabase.from("line_items").upsert(linePayload, { onConflict: "id" });
      if (lineError) throw lineError;

      if (removedLineIds.length) {
        const { error: deleteError } = await supabase.from("line_items").delete().in("id", removedLineIds);
        if (deleteError) throw deleteError;
      }

      setBusy(false);
      onSaved(roId, workspaceTab, previewMode);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "The work order could not be saved.");
      setBusy(false);
    }
  }

  return (
    <section>
      {vinScannerOpen && <div className="vin-scanner-backdrop" role="dialog" aria-modal="true" aria-label="Automatic VIN scanner">
        <div className="vin-scanner-modal">
          <div className="section-heading"><div><h2>Auto-scan VIN</h2><p className="muted">Hold steady with the full 17-character VIN inside the guide.</p></div><button className="button ghost" type="button" onClick={() => setVinScannerOpen(false)}>Cancel</button></div>
          <div className="vin-camera-frame"><video ref={vinVideoRef} muted playsInline /><div className="vin-camera-guide"><span>VIN</span></div></div>
          <p className="vin-scanner-status">Reading automatically… good lighting and a straight-on view work best.</p>
          <button className="button secondary" type="button" onClick={() => { setVinScannerOpen(false); window.setTimeout(() => vinPhotoRef.current?.click(), 0); }}>Take VIN photo instead</button>
        </div>
      </div>}
      <div className="workspace-heading">
        <div>
          <h1>{initialRo ? `RO #${padRo(initialRo.ro_number)}` : "New Work Order"}</h1>
          <p>One editable job. The estimate, shop work order, and invoice all use this same set of charges.</p>
        </div>
        <div className="workspace-actions">
          <div className="button-row button-row-muted">
            <button className="button ghost" onClick={onCancel}>Close</button>
            {initialRo && onDelete && (
              <button className="button ghost danger-text" onClick={onDelete}>Delete RO</button>
            )}
          </div>
          <div className="button-row">
            {initialRo && workspaceTab === "work_order" && onInspection && (
              <button className="button secondary" onClick={onInspection}>Multipoint Inspection</button>
            )}
            {initialRo && workspaceTab === "work_order" && (
              <>
                <button className="button ghost" onClick={() => save("estimate")} disabled={busy}>Preview Estimate</button>
                <button className="button ghost" onClick={() => save("work_order")} disabled={busy}>Preview Work Order</button>
                <button className="button secondary" onClick={() => void emailEstimate()} disabled={busy}>Email Estimate</button>
              </>
            )}
            {initialRo && workspaceTab === "invoice" && (
              <>
                <button className="button ghost" onClick={() => save("invoice")} disabled={busy}>Preview Invoice</button>
                <button className="button secondary" onClick={() => void emailInvoice()} disabled={busy}>Email Invoice</button>
              </>
            )}
            <button className="button primary" onClick={() => save()} disabled={busy}>
              {busy ? "Saving…" : "Save Changes"}
            </button>
          </div>
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

      {hasCustomerAuthorizationResponse && currentAuthorization && (
        <section className={`approval-overview ${currentAuthorization.status}`} aria-label="Customer estimate decisions">
          <div className="approval-overview-heading">
            <div>
              <span>Customer decision</span>
              <h2>{currentAuthorization.status.replaceAll("_", " ")}</h2>
              <small>
                {currentAuthorization.customer_name ? `${currentAuthorization.customer_name} · ` : ""}
                {currentAuthorization.responded_at ? new Date(currentAuthorization.responded_at).toLocaleString() : "Response received"}
              </small>
            </div>
            <div className="approval-overview-total">
              <span>Authorized total</span>
              <strong>{money(Number(currentAuthorization.approved_total || 0))}</strong>
            </div>
          </div>
          <div className="approval-overview-decisions">
            <div className="approved">
              <strong>✓ Approved ({currentDecisionSummary.approved.length})</strong>
              <p>{currentDecisionSummary.approved.length ? currentDecisionSummary.approved.join(" · ") : "None"}</p>
            </div>
            <div className="declined">
              <strong>✕ Declined ({currentDecisionSummary.declined.length})</strong>
              <p>{currentDecisionSummary.declined.length ? currentDecisionSummary.declined.join(" · ") : "None"}</p>
            </div>
          </div>
        </section>
      )}

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
              <button className="button secondary" type="button" onClick={() => void decodeVin()} disabled={vinBusy}>
                {vinBusy ? "Decoding…" : "Decode VIN"}
              </button>
              <input ref={vinPhotoRef} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => void scanVinPhoto(event.target.files?.[0])} />
              <button className="button primary" type="button" onClick={() => setVinScannerOpen(true)} disabled={vinBusy}>
                {vinBusy ? "Reading…" : "Auto-scan VIN"}
              </button>
              <button className="button ghost" type="button" onClick={() => vinPhotoRef.current?.click()} disabled={vinBusy}>
                Take VIN photo
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
            <div><span>Subtotal</span><strong>{money(displayedTotals.subtotal)}</strong></div>
            <div><span>Tax</span><strong>{money(displayedTotals.tax)}</strong></div>
            <div className="grand-total"><span>{workspaceTab === "invoice" ? "Billable total" : "Estimate total"}</span><strong>{money(displayedTotals.total)}</strong></div>
          </div>
          {workspaceTab === "invoice" && hasCustomerAuthorizationResponse && (
            <p className="sidebar-help invoice-authorization-help">Approved services and jobs with separately recorded authorization are billed. Other declined recommendations are not charged.</p>
          )}
          {workspaceTab === "invoice" && authorizationOverage > 0.01 && (
            <div className="invoice-authorization-warning" role="alert">
              <strong>Invoice exceeds authorization by {money(authorizationOverage)}</strong>
              <span>The original signed amount is unchanged. Record separate authorization for added work before billing it.</span>
            </div>
          )}
          {!hideCostAndMargin && (
            <section className="ro-profit-summary">
              <div className="ro-profit-title"><strong>Internal RO profit</strong><span>Private</span></div>
              <div><span>Revenue</span><strong>{money(profitSummary.revenue)}</strong></div>
              <div><span>Recorded cost</span><strong>{money(profitSummary.cost)}</strong></div>
              <div className={profitSummary.profit >= 0 ? "positive" : "negative"}><span>Gross profit</span><strong>{money(profitSummary.profit)}</strong></div>
              <div className={profitSummary.margin >= 0 ? "positive" : "negative"}><span>Gross margin</span><strong>{profitSummary.margin.toFixed(1)}%</strong></div>
              <small>{profitSummary.usesAuthorization ? "Includes separately authorized jobs." : "All currently listed services."} Labor and overhead are not deducted.</small>
            </section>
          )}
        </aside>
      </div>

      {canRestructureRo && settings.team_features_enabled && initialRo && (
        <TechnicianAssignment ownerId={ownerId} repairOrderId={initialRo.id} />
      )}

      <section className="panel line-items-panel">
        <div className="section-heading wrap">
          <div>
            <h2>{workspaceTab === "invoice" ? "Invoice service jobs" : "Service jobs"}</h2>
            <p className="muted">
              {workspaceTab === "invoice"
                ? "Add jobs here, then use Include on invoice to record separate customer authorization. Other declined jobs remain uncharged."
                : `Build each repair as a job. Labor defaults to ${money(settings.default_labor_rate)}/hr and parts to ${settings.default_parts_markup}% markup.`}
            </p>
          </div>
          {canRestructureRo && (
            <div className="button-row">
              <button className="button primary" onClick={addServiceJob}>+ Add Service Job</button>
              <button className="button secondary" onClick={() => addItem("fee")}>+ Fee</button>
              <button className="button discount-button" onClick={() => addItem("discount")}>+ Discount</button>
            </div>
          )}
        </div>

        <div className="service-jobs">
          {serviceGroups.map((group, groupIndex) => {
            const first = group.items[0];
            const customerDecision = hasCustomerAuthorizationResponse ? currentDecisions[group.id] : undefined;
            const jobTotal = group.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
            const jobCost = group.items.reduce((sum, item) =>
              sum + (item.item_type === "part" ? item.quantity * Number(item.unit_cost || 0) : 0), 0
            );
            const jobGrossProfit = jobTotal - jobCost;
            const jobGrossMargin = jobTotal !== 0 ? (jobGrossProfit / jobTotal) * 100 : 0;
            return (
              <article className={`service-job-card ${customerDecision ? `customer-${customerDecision}` : ""}`} key={group.id}>
                <header className="service-job-header">
                  <div className="service-job-number">{groupIndex + 1}</div>
                  <label>
                    Recommended service
                    <input value={first.service_group_title ?? ""} onChange={(event) => updateServiceJob(group.id, "service_group_title", event.target.value)} />
                  </label>
                  <div className="service-job-total">
                    {invoiceOverrides[group.id] && <span className="authorization-mark approved">Separately authorized</span>}
                    {customerDecision && <span className={`authorization-mark ${customerDecision}`}>{invoiceOverrides[group.id] ? `Originally ${customerDecision}` : customerDecision}</span>}
                    <span>Job total</span><strong>{money(jobTotal)}</strong>
                  </div>
                  {canRestructureRo && (
                    <button className="button small danger" onClick={() => void deleteServiceJob(group.id)}>Delete job</button>
                  )}
                </header>
                {hasCustomerAuthorizationResponse && (
                  <div className="notice">
                    {invoiceOverrides[group.id] ? (
                      <><strong>Separate authorization: </strong>{invoiceOverrides[group.id].note}
                        <button className="button small ghost" type="button" onClick={() => {
                          if (!window.confirm("Remove the separate authorization? This job will follow the original estimate decision again.")) return;
                          setInvoiceOverrides((current) => { const next = { ...current }; delete next[group.id]; return next; });
                        }}>Remove override</button>
                      </>
                    ) : (
                      <><span>{customerDecision === "approved" ? "Record separate authorization for changes to this job." : "This job is excluded from the invoice until separately authorized."}</span>
                        <button className="button small secondary" type="button" onClick={() => overrideInvoiceJob(group.id)}>{customerDecision === "approved" ? "Record additional authorization" : "Include on invoice"}</button>
                      </>
                    )}
                  </div>
                )}
                <div className="service-job-narratives">
                  <label className="recommendation-story">
                    Recommendation / reason <span className="visibility-tag customer">Estimate + approval</span>
                    <textarea
                      rows={3}
                      placeholder="Example: Front brake pads are below minimum thickness and the rotors are scored. Recommend replacing pads and rotors."
                      value={first.technician_story ?? ""}
                      onChange={(event) => updateServiceJob(group.id, "technician_story", event.target.value)}
                    />
                  </label>
                  <label className="work-performed-story">
                    Work performed <span className="visibility-tag invoice">Invoice only</span>
                    <textarea
                      rows={3}
                      placeholder="Complete after the repair. Example: Replaced front pads and rotors, lubricated slide pins, and road-tested vehicle."
                      value={first.work_performed ?? ""}
                      onChange={(event) => updateServiceJob(group.id, "work_performed", event.target.value)}
                    />
                  </label>
                  <label className="internal-job-notes">
                    Internal technician notes <span className="visibility-tag private">Private</span>
                    <textarea
                      rows={2}
                      placeholder="Shop instructions, reminders, or details the customer should not see."
                      value={first.internal_notes ?? ""}
                      onChange={(event) => updateServiceJob(group.id, "internal_notes", event.target.value)}
                    />
                  </label>
                </div>
                {!hideCostAndMargin && (
                  <section className="job-profit-panel" aria-label="Internal job profitability">
                    <div className="job-profit-heading">
                      <strong>Internal job profit</strong>
                      <span>Private — never shown on customer documents</span>
                    </div>
                    <div><span>Job revenue</span><strong>{money(jobTotal)}</strong></div>
                    <div><span>Recorded cost</span><strong>{money(jobCost)}</strong></div>
                    <div className={jobGrossProfit >= 0 ? "positive" : "negative"}><span>Gross profit</span><strong>{money(jobGrossProfit)}</strong></div>
                    <div className={jobGrossMargin >= 0 ? "positive" : "negative"}><span>Gross margin</span><strong>{jobGrossMargin.toFixed(1)}%</strong></div>
                    <small>Uses customer price minus recorded part/sublet costs. Labor and shop overhead are not deducted.</small>
                  </section>
                )}
                <div className="job-lines">
                  {group.items.map((item) => (
                    <ChargeLine
                      key={item.id}
                      item={item}
                      changeItem={changeItem}
                      removeItem={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
                      hideCostAndMargin={hideCostAndMargin}
                      priceEditable={item.item_type === "part" ? partPriceEditable : canRestructureRo}
                      canRemove={canRestructureRo}
                    />
                  ))}
                </div>
                {initialRo && workspaceTab === "work_order" && (
                  <>
                    <JobPhotos ownerId={ownerId} repairOrderId={initialRo.id} serviceGroupId={group.id} />
                    <JobVideos ownerId={ownerId} repairOrderId={initialRo.id} serviceGroupId={group.id} />
                  </>
                )}
                <div className="job-add-actions">
                  {canRestructureRo && <button className="button small secondary" onClick={() => addItem("labor", group.id)}>+ Labor</button>}
                  {canAddPartLine && <button className="button small secondary" onClick={() => addItem("part", group.id)}>+ Associated Part</button>}
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
                  <ChargeLine
                    key={item.id}
                    item={item}
                    changeItem={changeItem}
                    removeItem={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
                    hideCostAndMargin={hideCostAndMargin}
                    priceEditable={canRestructureRo}
                    canRemove={canRestructureRo}
                  />
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

function TechnicianAssignment({ ownerId, repairOrderId }: { ownerId: string; repairOrderId: string }) {
  const [technicians, setTechnicians] = useState<StaffMember[]>([]);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function loadAll() {
    const [staffResult, assignmentsResult] = await Promise.all([
      supabase.from("staff").select("*").eq("role", "technician").eq("active", true).order("name"),
      supabase.from("repair_order_technicians").select("staff_id").eq("repair_order_id", repairOrderId),
    ]);
    if (staffResult.error) setMessage(staffResult.error.message);
    if (assignmentsResult.error) setMessage(assignmentsResult.error.message);
    setTechnicians((staffResult.data ?? []) as StaffMember[]);
    setAssignedIds(((assignmentsResult.data ?? []) as Array<{ staff_id: string }>).map((row) => row.staff_id));
    setLoading(false);
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repairOrderId]);

  async function toggle(staffId: string, assign: boolean) {
    setBusy(true);
    setMessage("");
    const { error } = assign
      ? await supabase.from("repair_order_technicians").insert({ owner_id: ownerId, repair_order_id: repairOrderId, staff_id: staffId })
      : await supabase.from("repair_order_technicians").delete().eq("repair_order_id", repairOrderId).eq("staff_id", staffId);
    if (error) setMessage(error.message);
    await loadAll();
    setBusy(false);
  }

  return (
    <section className="panel">
      <h3 style={{ marginTop: 0 }}>Assigned technicians</h3>
      <p className="muted" style={{ marginTop: -6, fontSize: 13 }}>Reassign anytime — technicians only see jobs assigned to them here (unless their account is set to see all shop work).</p>
      {message && <div className="notice">{message}</div>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : !technicians.length ? (
        <p className="muted">No active technicians yet. Add them in Settings → Staff &amp; Teams.</p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {technicians.map((tech) => {
            const assigned = assignedIds.includes(tech.id);
            return (
              <button
                key={tech.id}
                type="button"
                className={`button small ${assigned ? "primary" : "secondary"}`}
                disabled={busy}
                onClick={() => void toggle(tech.id, !assigned)}
              >
                {assigned ? "✓ " : "+ "}{tech.name}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

async function compressPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const maxDimension = 1600;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Could not prepare the photo.")),
    "image/jpeg",
    0.8
  ));
}

function JobPhotos({ ownerId, repairOrderId, serviceGroupId }: { ownerId: string; repairOrderId: string; serviceGroupId: string }) {
  const [photos, setPhotos] = useState<EstimatePhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function loadPhotos() {
    const { data, error } = await supabase.from("estimate_photos").select("*")
      .eq("repair_order_id", repairOrderId).eq("service_group_id", serviceGroupId).order("sort_order");
    if (error) { setMessage(error.message); return; }
    const withUrls = await Promise.all(((data ?? []) as EstimatePhoto[]).map(async (photo) => {
      const result = await supabase.storage.from("estimate-photos").createSignedUrl(photo.storage_path, 3600);
      return { ...photo, signed_url: result.data?.signedUrl };
    }));
    setPhotos(withUrls);
  }

  useEffect(() => { void loadPhotos(); }, [repairOrderId, serviceGroupId]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setMessage("");
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const compressed = await compressPhoto(file);
        const path = `${ownerId}/${repairOrderId}/${serviceGroupId}/${crypto.randomUUID()}.jpg`;
        const uploadResult = await supabase.storage.from("estimate-photos").upload(path, compressed, { contentType: "image/jpeg" });
        if (uploadResult.error) throw uploadResult.error;
        const insertResult = await supabase.from("estimate_photos").insert({
          owner_id: ownerId, repair_order_id: repairOrderId, service_group_id: serviceGroupId,
          storage_path: path, caption: null, sort_order: photos.length,
        });
        if (insertResult.error) {
          await supabase.storage.from("estimate-photos").remove([path]);
          throw insertResult.error;
        }
      }
      await loadPhotos();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Photo upload failed.");
    } finally { setBusy(false); }
  }

  async function saveCaption(photo: EstimatePhoto, caption: string) {
    setPhotos((current) => current.map((entry) => entry.id === photo.id ? { ...entry, caption } : entry));
    const { error } = await supabase.from("estimate_photos").update({ caption: valueOrNull(caption) }).eq("id", photo.id);
    if (error) setMessage(error.message);
  }

  async function removePhoto(photo: EstimatePhoto) {
    if (!window.confirm("Delete this job photo?")) return;
    setBusy(true); setMessage("");
    const storageResult = await supabase.storage.from("estimate-photos").remove([photo.storage_path]);
    const tableResult = storageResult.error ? null : await supabase.from("estimate_photos").delete().eq("id", photo.id);
    if (storageResult.error || tableResult?.error) setMessage(storageResult.error?.message || tableResult?.error?.message || "Delete failed.");
    else setPhotos((current) => current.filter((entry) => entry.id !== photo.id));
    setBusy(false);
  }

  return (
    <section className="job-photos">
      <div className="job-photo-heading">
        <div><strong>Customer estimate photos</strong><small>Saved with this RO and shown under this service job.</small></div>
        <label className={`button small secondary photo-upload-button ${busy ? "disabled" : ""}`}>
          {busy ? "Uploading…" : "+ Take or add photos"}
          <input type="file" accept="image/*" capture="environment" multiple disabled={busy} onChange={(event) => { void upload(event.target.files); event.target.value = ""; }} />
        </label>
      </div>
      {photos.length > 0 && <div className="job-photo-grid">{photos.map((photo) => (
        <article className="job-photo-card" key={photo.id}>
          {photo.signed_url && <img src={photo.signed_url} alt={photo.caption || "Service job photo"} />}
          <input placeholder="Add a customer-facing caption…" value={photo.caption ?? ""}
            onChange={(event) => setPhotos((current) => current.map((entry) => entry.id === photo.id ? { ...entry, caption: event.target.value } : entry))}
            onBlur={(event) => void saveCaption(photo, event.target.value)} />
          <button className="button small danger" disabled={busy} onClick={() => void removePhoto(photo)}>Delete photo</button>
        </article>
      ))}</div>}
      {message && <div className="notice">{message}</div>}
    </section>
  );
}

const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200MB — generous for a 1-2 minute phone clip, keeps a mis-tap from eating the whole R2 free tier in one upload.

function JobVideos({ ownerId, repairOrderId, serviceGroupId }: { ownerId: string; repairOrderId: string; serviceGroupId: string }) {
  const [videos, setVideos] = useState<EstimateVideo[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error("Your session expired. Sign in again.");
    return { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` };
  }

  async function loadVideos() {
    const { data, error } = await supabase.from("estimate_videos").select("*")
      .eq("repair_order_id", repairOrderId).eq("service_group_id", serviceGroupId).order("sort_order");
    if (error) { setMessage(error.message); return; }
    setVideos((data ?? []) as EstimateVideo[]);
  }

  useEffect(() => { void loadVideos(); }, [repairOrderId, serviceGroupId]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setMessage("");
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("video/")) continue;
        if (file.size > MAX_VIDEO_BYTES) throw new Error(`${file.name} is larger than 200MB — trim it and try again.`);
        const headers = await authHeader();
        const urlResponse = await fetch("/.netlify/functions/create-video-upload-url", {
          method: "POST", headers, body: JSON.stringify({ repairOrderId, contentType: file.type || "video/mp4" }),
        });
        const urlBody = await urlResponse.json() as { uploadUrl?: string; key?: string; contentType?: string; error?: string };
        if (!urlResponse.ok || !urlBody.uploadUrl || !urlBody.key) throw new Error(urlBody.error || "Could not start the video upload.");
        const putResponse = await fetch(urlBody.uploadUrl, { method: "PUT", headers: { "Content-Type": urlBody.contentType || file.type }, body: file });
        if (!putResponse.ok) throw new Error("Uploading the video failed — check your connection and try again.");
        const insertResult = await supabase.from("estimate_videos").insert({
          owner_id: ownerId, repair_order_id: repairOrderId, service_group_id: serviceGroupId,
          storage_key: urlBody.key, content_type: urlBody.contentType || file.type, caption: null, sort_order: videos.length,
        });
        if (insertResult.error) throw insertResult.error;
      }
      await loadVideos();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Video upload failed.");
    } finally { setBusy(false); }
  }

  async function playVideo(video: EstimateVideo) {
    setMessage("");
    try {
      const headers = await authHeader();
      const response = await fetch("/.netlify/functions/get-video-url", {
        method: "POST", headers, body: JSON.stringify({ videoId: video.id }),
      });
      const body = await response.json() as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error || "Could not load this video.");
      window.open(body.url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not load this video.");
    }
  }

  async function saveCaption(video: EstimateVideo, caption: string) {
    setVideos((current) => current.map((entry) => entry.id === video.id ? { ...entry, caption } : entry));
    const { error } = await supabase.from("estimate_videos").update({ caption: valueOrNull(caption) }).eq("id", video.id);
    if (error) setMessage(error.message);
  }

  async function removeVideo(video: EstimateVideo) {
    if (!window.confirm("Delete this job video? This cannot be undone.")) return;
    setBusy(true); setMessage("");
    // Only the database row is deleted here — the R2 object is left in place. Cheap enough at this
    // scale (storage overage is $0.015/GB) that a periodic cleanup job isn't worth building yet;
    // revisit if orphaned objects ever become a real cost.
    const { error } = await supabase.from("estimate_videos").delete().eq("id", video.id);
    if (error) setMessage(error.message);
    else setVideos((current) => current.filter((entry) => entry.id !== video.id));
    setBusy(false);
  }

  return (
    <section className="job-photos">
      <div className="job-photo-heading">
        <div><strong>Customer estimate videos</strong><small>Saved with this RO and shown under this service job.</small></div>
        <label className={`button small secondary photo-upload-button ${busy ? "disabled" : ""}`}>
          {busy ? "Uploading…" : "+ Take or add video"}
          <input type="file" accept="video/*" capture="environment" multiple disabled={busy} onChange={(event) => { void upload(event.target.files); event.target.value = ""; }} />
        </label>
      </div>
      {videos.length > 0 && <div className="job-photo-grid">{videos.map((video) => (
        <article className="job-photo-card" key={video.id}>
          <button type="button" className="button small secondary" onClick={() => void playVideo(video)}>▶ Play video</button>
          <input placeholder="Add a customer-facing caption…" value={video.caption ?? ""}
            onChange={(event) => setVideos((current) => current.map((entry) => entry.id === video.id ? { ...entry, caption: event.target.value } : entry))}
            onBlur={(event) => void saveCaption(video, event.target.value)} />
          <button className="button small danger" disabled={busy} onClick={() => void removeVideo(video)}>Delete video</button>
        </article>
      ))}</div>}
      {message && <div className="notice">{message}</div>}
    </section>
  );
}

function ChargeLine({
  item,
  changeItem,
  removeItem,
  hideCostAndMargin = false,
  priceEditable = true,
  canRemove = true,
}: {
  item: LineItem;
  changeItem: (id: string, field: keyof LineItem, rawValue: string | boolean | number) => void;
  removeItem: () => void;
  hideCostAndMargin?: boolean;
  priceEditable?: boolean;
  canRemove?: boolean;
}) {
  const showRate = item.item_type !== "labor" || !hideCostAndMargin;
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
      {item.item_type === "part" && !hideCostAndMargin && (
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
      {showRate ? (
        <label>
          {item.item_type === "labor" ? "Rate" : item.item_type === "discount" ? "Discount amount" : "Unit price"}
          <input
            type="number"
            step="0.01"
            value={item.item_type === "discount" ? Math.abs(item.unit_price) : Number(item.unit_price.toFixed(2))}
            disabled={!priceEditable}
            onChange={(event) => changeItem(item.id, "unit_price", event.target.value)}
          />
        </label>
      ) : (
        <label>
          Rate
          <input type="text" value="—" disabled title="Only the owner or an admin can view or change the labor rate." />
        </label>
      )}
      <label className="checkbox-row compact">
        <input type="checkbox" checked={item.taxable} onChange={(event) => changeItem(item.id, "taxable", event.target.checked)} disabled={!priceEditable} />
        Tax
      </label>
      <div className="line-total">
        <span>{item.item_type === "discount" ? "You save" : "Total"}</span>
        <strong>{hideCostAndMargin && item.item_type === "labor" ? "—" : money(item.item_type === "discount" ? Math.abs(item.quantity * item.unit_price) : item.quantity * item.unit_price)}</strong>
      </div>
      {canRemove && <button className="icon-button" title="Remove line" onClick={removeItem}>×</button>}
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
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Address</th>
                <th>Vehicles</th>
                <th>WOs</th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((customer) => {
                const ownedVehicles = vehicles.filter((vehicle) => vehicle.customer_id === customer.id);
                const roCount = repairOrders.filter((ro) => ro.customer_id === customer.id).length;
                const vehicleSummary = ownedVehicles
                  .slice(0, 2)
                  .map((vehicle) => [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle")
                  .join(", ");
                return (
                  <tr key={customer.id} className={customer.archived_at ? "archived-row" : ""}>
                    <td>
                      <button className="table-link" onClick={() => onOpenCustomer(customer)}>{customer.name}</button>
                      {customer.archived_at && <span className="badge archived" style={{ marginLeft: 8 }}>Archived</span>}
                    </td>
                    <td>{[customer.phone, customer.email].filter(Boolean).join(" · ") || "—"}</td>
                    <td>{[customer.address_line_1, customer.city, customer.state, customer.zip_code].filter(Boolean).join(", ") || "—"}</td>
                    <td>
                      {ownedVehicles.length
                        ? `${vehicleSummary}${ownedVehicles.length > 2 ? ` +${ownedVehicles.length - 2} more` : ""}`
                        : "No vehicles"}
                    </td>
                    <td>{roCount}</td>
                    <td className="actions-cell">
                      <button className="button small secondary" onClick={() => onOpenCustomer(customer)}>History</button>
                      <button className="button small ghost" onClick={() => onArchive(customer)}>
                        {customer.archived_at ? "Restore" : "Archive"}
                      </button>
                    </td>
                    <td className="actions-cell">
                      {roCount === 0 ? (
                        <button className="button small danger" onClick={() => onDelete(customer)}>Delete</button>
                      ) : (
                        <span className="history-lock">Has history</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr>
                  <td colSpan={7} className="empty-state">
                    {showArchived ? "No matching customers." : "No matching active customers."}
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
                    <th>Billable total</th>
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

function PaymentsPanel({
  ownerId,
  settings,
  pendingStripeOAuthCode,
  onStripeOAuthCodeHandled,
  stripeReturnPending,
  onStripeReturnHandled,
  onStatusChanged,
}: {
  ownerId: string;
  settings: Settings;
  pendingStripeOAuthCode: string | null;
  onStripeOAuthCodeHandled: () => void;
  stripeReturnPending: boolean;
  onStripeReturnHandled: () => void;
  onStatusChanged: () => void;
}) {
  const [status, setStatus] = useState({
    accountId: settings.stripe_account_id,
    accountType: settings.stripe_account_type,
    onboardingComplete: settings.stripe_onboarding_complete,
    chargesEnabled: settings.stripe_charges_enabled,
    payoutsEnabled: settings.stripe_payouts_enabled,
  });
  const [busy, setBusy] = useState<"" | "express" | "standard" | "refresh">("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setStatus({
      accountId: settings.stripe_account_id,
      accountType: settings.stripe_account_type,
      onboardingComplete: settings.stripe_onboarding_complete,
      chargesEnabled: settings.stripe_charges_enabled,
      payoutsEnabled: settings.stripe_payouts_enabled,
    });
  }, [settings.stripe_account_id, settings.stripe_account_type, settings.stripe_onboarding_complete, settings.stripe_charges_enabled, settings.stripe_payouts_enabled]);

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error("Your session expired. Sign in again.");
    return { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` };
  }

  async function connect(accountType: "express" | "standard") {
    setBusy(accountType);
    setMessage("");
    try {
      const headers = await authHeader();
      const response = await fetch("/.netlify/functions/stripe-connect-onboard", {
        method: "POST", headers, body: JSON.stringify({ accountType }),
      });
      const body = await response.json() as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error || "Could not start Stripe onboarding.");
      window.location.href = body.url;
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not start Stripe onboarding.");
      setBusy("");
    }
  }

  async function refreshStatus() {
    setBusy("refresh");
    setMessage("");
    try {
      const headers = await authHeader();
      const response = await fetch("/.netlify/functions/stripe-connect-status", { method: "POST", headers });
      const body = await response.json() as { connected?: boolean; stripe_onboarding_complete?: boolean; stripe_charges_enabled?: boolean; stripe_payouts_enabled?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not check Stripe status.");
      if (body.connected) {
        setStatus((current) => ({
          ...current,
          onboardingComplete: Boolean(body.stripe_onboarding_complete),
          chargesEnabled: Boolean(body.stripe_charges_enabled),
          payoutsEnabled: Boolean(body.stripe_payouts_enabled),
        }));
      }
      onStatusChanged();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not check Stripe status.");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    if (stripeReturnPending) {
      onStripeReturnHandled();
      void refreshStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripeReturnPending]);

  useEffect(() => {
    if (!pendingStripeOAuthCode) return;
    const code = pendingStripeOAuthCode;
    onStripeOAuthCodeHandled();
    (async () => {
      setBusy("standard");
      setMessage("");
      try {
        const headers = await authHeader();
        const response = await fetch("/.netlify/functions/stripe-connect-oauth-callback", {
          method: "POST", headers, body: JSON.stringify({ code }),
        });
        const body = await response.json() as { connected?: boolean; stripe_charges_enabled?: boolean; stripe_payouts_enabled?: boolean; stripe_onboarding_complete?: boolean; error?: string };
        if (!response.ok) throw new Error(body.error || "Stripe did not authorize the connection.");
        setStatus({
          accountId: "connected",
          accountType: "standard",
          onboardingComplete: Boolean(body.stripe_onboarding_complete),
          chargesEnabled: Boolean(body.stripe_charges_enabled),
          payoutsEnabled: Boolean(body.stripe_payouts_enabled),
        });
        setMessage("Stripe account connected.");
        onStatusChanged();
      } catch (caught) {
        setMessage(caught instanceof Error ? caught.message : "Stripe did not authorize the connection.");
      } finally {
        setBusy("");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingStripeOAuthCode]);

  const connected = Boolean(status.accountId);
  const fullyReady = connected && status.onboardingComplete && status.chargesEnabled;

  return (
    <div className="panel settings-panel">
      <h2 style={{ marginTop: 0 }}>Payments</h2>
      <p className="muted" style={{ marginTop: -6, fontSize: 13 }}>
        Connect your shop&apos;s own Stripe account so customer card and bank-transfer (ACH) payments go straight to your
        bank. Money never passes through us — we don&apos;t hold or move your funds.
      </p>
      {message && <div className="notice" style={{ marginTop: 10 }}>{message}</div>}

      {!connected ? (
        <div style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px", border: "1px solid #e7eaf0", borderRadius: 10, padding: 16 }}>
            <strong>Quick setup</strong>
            <p className="muted" style={{ fontSize: 13, margin: "6px 0 12px" }}>
              A few minutes, Stripe-hosted signup. Best if you don&apos;t already use Stripe for anything else.
            </p>
            <button type="button" className="button primary" disabled={busy !== ""} onClick={() => void connect("express")}>
              {busy === "express" ? "Starting…" : "Connect with Stripe"}
            </button>
          </div>
          <div style={{ flex: "1 1 260px", border: "1px solid #e7eaf0", borderRadius: 10, padding: 16 }}>
            <strong>I already have Stripe</strong>
            <p className="muted" style={{ fontSize: 13, margin: "6px 0 12px" }}>
              Log into your existing Stripe account and link it directly — full control stays in your own Stripe dashboard.
            </p>
            <button type="button" className="button secondary" disabled={busy !== ""} onClick={() => void connect("standard")}>
              {busy === "standard" ? "Starting…" : "Connect existing Stripe account"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span className={`button small ${fullyReady ? "primary" : "ghost"}`} style={{ pointerEvents: "none" }}>
              {fullyReady ? "Connected & ready" : status.onboardingComplete ? "Connected — verification pending" : "Onboarding not finished"}
            </span>
            <span className="muted" style={{ fontSize: 13 }}>
              {status.accountType === "standard" ? "Standard account" : "Express account"} · Charges {status.chargesEnabled ? "enabled" : "disabled"} · Payouts {status.payoutsEnabled ? "enabled" : "disabled"}
            </span>
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {!fullyReady && status.accountType === "express" && (
              <button type="button" className="button primary" disabled={busy !== ""} onClick={() => void connect("express")}>
                {busy === "express" ? "Starting…" : "Continue onboarding"}
              </button>
            )}
            <button type="button" className="button secondary" disabled={busy !== ""} onClick={() => void refreshStatus()}>
              {busy === "refresh" ? "Checking…" : "Refresh status"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BillingPanel({ settings }: { settings: Settings }) {
  const [busy, setBusy] = useState<"" | "subscribe" | "portal">("");
  const [message, setMessage] = useState("");

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error("Your session expired. Sign in again.");
    return { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` };
  }

  async function subscribe() {
    setBusy("subscribe");
    setMessage("");
    try {
      const headers = await authHeader();
      const response = await fetch("/.netlify/functions/create-subscription-checkout", { method: "POST", headers });
      const body = await response.json() as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error || "Could not start checkout.");
      window.location.href = body.url;
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not start checkout.");
      setBusy("");
    }
  }

  async function manageBilling() {
    setBusy("portal");
    setMessage("");
    try {
      const headers = await authHeader();
      const response = await fetch("/.netlify/functions/create-billing-portal-session", { method: "POST", headers });
      const body = await response.json() as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error || "Could not open the billing portal.");
      window.location.href = body.url;
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not open the billing portal.");
      setBusy("");
    }
  }

  const status = settings.subscription_status;
  const rosLeft = Math.max(0, settings.trial_ro_limit - settings.trial_ro_created_count);
  const price = settings.plan_price_cents != null ? `$${(settings.plan_price_cents / 100).toFixed(2)}/mo` : "—";

  return (
    <div className="panel settings-panel">
      <h2 style={{ marginTop: 0 }}>Billing</h2>
      {message && <div className="notice" style={{ marginTop: 10 }}>{message}</div>}

      {status === "exempt" ? (
        <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>This shop isn&apos;t billed.</p>
      ) : status === "trialing" ? (
        <>
          <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
            Free trial — {rosLeft} of {settings.trial_ro_limit} repair order{settings.trial_ro_limit === 1 ? "" : "s"} left.
            {rosLeft === 0 ? " Subscribe to keep creating new ones." : ` Subscribing costs ${price} once you're ready.`}
          </p>
          <button type="button" className="button primary" disabled={busy !== ""} onClick={() => void subscribe()}>
            {busy === "subscribe" ? "Starting…" : `Subscribe — ${price}`}
          </button>
        </>
      ) : status === "active" ? (
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span className="button small primary" style={{ pointerEvents: "none" }}>Active</span>
            <span className="muted" style={{ fontSize: 13 }}>
              {price}
              {settings.subscription_current_period_end ? ` · renews ${new Date(settings.subscription_current_period_end).toLocaleDateString()}` : ""}
            </span>
          </div>
          <button type="button" className="button secondary" style={{ marginTop: 12 }} disabled={busy !== ""} onClick={() => void manageBilling()}>
            {busy === "portal" ? "Opening…" : "Manage billing"}
          </button>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span className="button small warning" style={{ pointerEvents: "none" }}>
              {status === "past_due" ? "Payment needs attention" : "Subscription canceled"}
            </span>
            <span className="muted" style={{ fontSize: 13 }}>
              {status === "past_due"
                ? (() => {
                    const daysLeft = pastDueDaysLeft(settings);
                    return daysLeft !== null && daysLeft > 0
                      ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left to fix this before the account goes read-only.`
                      : "Access is now read-only until this is resolved.";
                  })()
                : "Access is read-only until this is resolved."}
            </span>
          </div>
          <button type="button" className="button primary" style={{ marginTop: 12 }} disabled={busy !== ""} onClick={() => void manageBilling()}>
            {busy === "portal" ? "Opening…" : "Manage billing"}
          </button>
        </div>
      )}
    </div>
  );
}

type PlatformTenant = {
  owner_id: string;
  business_name: string | null;
  business_email: string | null;
  subscription_status: "trialing" | "active" | "past_due" | "canceled" | "exempt";
  plan_price_cents: number | null;
  trial_ro_limit: number;
  trial_ro_created_count: number;
  is_platform_admin: boolean;
  subscription_current_period_end: string | null;
  subscription_past_due_since: string | null;
};

// Connor-only: every shop on the platform, with an editable price per shop ("legacy shops keep
// their original price, new shops get whatever the current default is"). Nothing here goes through
// RLS — it's all served by platform-admin.ts, which itself checks the caller's own
// settings.is_platform_admin before doing anything cross-tenant.
function PlatformAdminPanel() {
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [defaultPriceCents, setDefaultPriceCents] = useState<number | null>(null);
  const [defaultPriceInput, setDefaultPriceInput] = useState("");
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyOwnerId, setBusyOwnerId] = useState("");
  const [busyDefault, setBusyDefault] = useState(false);
  const [message, setMessage] = useState("");
  const [traffic, setTraffic] = useState<{ totalVisits: number; uniqueVisitors: number; daily: Array<{ date: string; visits: number; uniqueVisitors: number }> } | null>(null);
  const [trafficLoading, setTrafficLoading] = useState(true);
  const [trafficMessage, setTrafficMessage] = useState("");

  async function call(body: Record<string, unknown>) {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error("Your session expired. Sign in again.");
    const response = await fetch("/.netlify/functions/platform-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Request failed.");
    return result;
  }

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const result = await call({ action: "list" }) as { tenants: PlatformTenant[]; defaultPlanPriceCents: number | null };
      setTenants(result.tenants);
      setDefaultPriceCents(result.defaultPlanPriceCents);
      setDefaultPriceInput(result.defaultPlanPriceCents != null ? (result.defaultPlanPriceCents / 100).toFixed(2) : "");
      setPriceInputs(
        Object.fromEntries(result.tenants.map((tenant) => [tenant.owner_id, tenant.plan_price_cents != null ? (tenant.plan_price_cents / 100).toFixed(2) : ""]))
      );
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not load shops.");
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function loadTraffic() {
    setTrafficLoading(true);
    setTrafficMessage("");
    try {
      const result = await call({ action: "traffic" }) as { totalVisits: number; uniqueVisitors: number; daily: Array<{ date: string; visits: number; uniqueVisitors: number }> };
      setTraffic(result);
    } catch (caught) {
      setTrafficMessage(caught instanceof Error ? caught.message : "Could not load traffic.");
    }
    setTrafficLoading(false);
  }

  useEffect(() => {
    void loadTraffic();
  }, []);

  async function savePrice(ownerId: string) {
    const dollars = Number(priceInputs[ownerId]);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setMessage("Enter a valid price in dollars.");
      return;
    }
    setBusyOwnerId(ownerId);
    setMessage("");
    try {
      await call({ action: "update_price", ownerId, planPriceCents: Math.round(dollars * 100) });
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not update price.");
    }
    setBusyOwnerId("");
  }

  async function saveStatus(ownerId: string, status: PlatformTenant["subscription_status"]) {
    setBusyOwnerId(ownerId);
    setMessage("");
    try {
      await call({ action: "update_status", ownerId, status });
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not update status.");
    }
    setBusyOwnerId("");
  }

  async function saveDefaultPrice() {
    const dollars = Number(defaultPriceInput);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setMessage("Enter a valid price in dollars.");
      return;
    }
    setBusyDefault(true);
    setMessage("");
    try {
      await call({ action: "update_default_price", defaultPlanPriceCents: Math.round(dollars * 100) });
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not update the default price.");
    }
    setBusyDefault(false);
  }

  return (
    <section>
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Platform Admin</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
          Every shop on Allegiant RO, and what they&apos;re billed. Changing a shop&apos;s price only affects that shop —
          existing subscribers never change price unless you edit them here.
        </p>
        {message && <div className="notice" style={{ marginTop: 10 }}>{message}</div>}

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="muted" style={{ fontSize: 13 }}>Default price for new shops ($/mo)</span>
            <input
              type="number" min="0" step="0.01" style={{ width: 100 }}
              value={defaultPriceInput}
              onChange={(event) => setDefaultPriceInput(event.target.value)}
            />
          </label>
          <button type="button" className="button secondary small" disabled={busyDefault} onClick={() => void saveDefaultPrice()}>
            {busyDefault ? "Saving…" : "Save"}
          </button>
          {defaultPriceCents != null && (
            <span className="muted" style={{ fontSize: 12 }}>Currently ${(defaultPriceCents / 100).toFixed(2)}/mo</span>
          )}
        </div>

        {loading ? (
          <p className="muted" style={{ marginTop: 16 }}>Loading shops…</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>Shop</th>
                  <th>Status</th>
                  <th>Trial usage</th>
                  <th>Price ($/mo)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => (
                  <tr key={tenant.owner_id}>
                    <td>
                      <strong>{tenant.business_name || "—"}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>{tenant.business_email || "—"}</div>
                    </td>
                    <td>
                      <select
                        value={tenant.subscription_status}
                        disabled={busyOwnerId === tenant.owner_id}
                        onChange={(event) => void saveStatus(tenant.owner_id, event.target.value as PlatformTenant["subscription_status"])}
                      >
                        <option value="trialing">Trialing</option>
                        <option value="active">Active</option>
                        <option value="past_due">Past due</option>
                        <option value="canceled">Canceled</option>
                        <option value="exempt">Exempt (comped)</option>
                      </select>
                      {tenant.subscription_status === "past_due" && tenant.subscription_past_due_since && (() => {
                        const elapsedMs = Date.now() - new Date(tenant.subscription_past_due_since).getTime();
                        const daysLeft = Math.max(0, Math.ceil(7 - elapsedMs / (24 * 60 * 60 * 1000)));
                        return (
                          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                            {daysLeft > 0 ? `${daysLeft}d left in grace period` : "Read-only (grace period over)"}
                          </div>
                        );
                      })()}
                    </td>
                    <td>{tenant.trial_ro_created_count} / {tenant.trial_ro_limit} ROs</td>
                    <td>
                      <input
                        type="number" min="0" step="0.01" style={{ width: 90 }}
                        value={priceInputs[tenant.owner_id] ?? ""}
                        onChange={(event) => setPriceInputs((current) => ({ ...current, [tenant.owner_id]: event.target.value }))}
                      />
                    </td>
                    <td>
                      <button
                        type="button" className="button small secondary"
                        disabled={busyOwnerId === tenant.owner_id}
                        onClick={() => void savePrice(tenant.owner_id)}
                      >
                        {busyOwnerId === tenant.owner_id ? "Saving…" : "Save price"}
                      </button>
                    </td>
                  </tr>
                ))}
                {!tenants.length && <tr><td colSpan={5} className="empty-state">No shops yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <h2 style={{ marginTop: 0 }}>Site traffic</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
          Landing-page visits (the login/signup screen), counted by browser. Browsers that have ever
          logged into a paying (active or exempt) shop are excluded, so this leans toward prospective
          traffic rather than your existing customers reloading the login page.
        </p>
        {trafficMessage && <div className="notice" style={{ marginTop: 10 }}>{trafficMessage}</div>}
        {trafficLoading ? (
          <p className="muted" style={{ marginTop: 16 }}>Loading traffic…</p>
        ) : traffic ? (
          <>
            <div style={{ display: "flex", gap: 16, marginTop: 14, marginBottom: 20, flexWrap: "wrap" }}>
              <div className="panel" style={{ flex: "1 1 200px" }}>
                <div className="muted">All-time visits</div>
                <div style={{ fontSize: 28, fontWeight: 600 }}>{traffic.totalVisits.toLocaleString()}</div>
              </div>
              <div className="panel" style={{ flex: "1 1 200px" }}>
                <div className="muted">All-time unique visitors</div>
                <div style={{ fontSize: 28, fontWeight: 600 }}>{traffic.uniqueVisitors.toLocaleString()}</div>
              </div>
            </div>
            {!traffic.daily.length ? (
              <div className="empty-state">No visits recorded in the last 90 days yet.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Date</th><th>Visits</th><th>Unique visitors</th></tr>
                  </thead>
                  <tbody>
                    {traffic.daily.map((day) => (
                      <tr key={day.date}>
                        <td>{day.date}</td>
                        <td>{day.visits}</td>
                        <td>{day.uniqueVisitors}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}

function SettingsPanel({
  user,
  ownerId,
  isOwner,
  initialSettings,
  onSaved,
  pendingStripeOAuthCode,
  onStripeOAuthCodeHandled,
  stripeReturnPending,
  onStripeReturnHandled,
  onStripeStatusChanged,
}: {
  user: User;
  ownerId: string;
  isOwner: boolean;
  initialSettings: Settings;
  onSaved: () => void;
  pendingStripeOAuthCode: string | null;
  onStripeOAuthCodeHandled: () => void;
  stripeReturnPending: boolean;
  onStripeReturnHandled: () => void;
  onStripeStatusChanged: () => void;
}) {
  const [form, setForm] = useState<Settings>(initialSettings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--blue", form.primary_color);
    root.style.setProperty("--red", form.accent_color);
    root.style.setProperty("--navy", form.secondary_color);
  }, [form.primary_color, form.accent_color, form.secondary_color]);

  async function save() {
    setBusy(true);
    setMessage("");
    const payload = { ...form, owner_id: ownerId };
    const { error } = await supabase.from("settings").upsert(payload, { onConflict: "owner_id" });
    if (error) {
      setMessage(error.message);
      setBusy(false);
      return;
    }
    onSaved();
  }

  async function uploadLogo(file: File) {
    setLogoUploading(true);
    setMessage("");
    const extension = file.name.split(".").pop()?.toLowerCase() || "png";
    const path = `${ownerId}/logo-${Date.now()}.${extension}`;
    const previousPath = form.logo_path;
    const { error } = await supabase.storage.from("shop-branding").upload(path, file, { contentType: file.type });
    if (error) {
      setMessage(error.message);
      setLogoUploading(false);
      return;
    }
    if (previousPath) await supabase.storage.from("shop-branding").remove([previousPath]);
    setForm((current) => ({ ...current, logo_path: path }));
    setLogoUploading(false);
  }

  async function removeLogo() {
    if (!form.logo_path) return;
    setLogoUploading(true);
    await supabase.storage.from("shop-branding").remove([form.logo_path]);
    setForm((current) => ({ ...current, logo_path: null }));
    setLogoUploading(false);
  }

  const logoUrl = logoPublicUrl(form.logo_path);

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Settings</h1>
          <p>Business information, branding, and default pricing.</p>
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
            Zelle phone or email <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
            <input
              value={form.zelle_recipient || ""}
              placeholder="e.g. (555) 123-4567 or payments@yourshop.com"
              onChange={(event) => setForm({ ...form, zelle_recipient: event.target.value || null })}
            />
            <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
              Lets customers pay invoices via Zelle as well as card. Payments are confirmed manually — you check your own bank app before marking paid.
            </span>
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

      <div className="panel settings-panel">
        <h2 style={{ marginTop: 0 }}>Branding</h2>
        <div className="form-grid two">
          <label>
            Primary color
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="color" value={form.primary_color} onChange={(event) => setForm({ ...form, primary_color: event.target.value })} style={{ width: 44, height: 36, padding: 2 }} />
              <input value={form.primary_color} onChange={(event) => setForm({ ...form, primary_color: event.target.value })} style={{ flex: 1 }} />
            </div>
          </label>
          <label>
            Accent color
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="color" value={form.accent_color} onChange={(event) => setForm({ ...form, accent_color: event.target.value })} style={{ width: 44, height: 36, padding: 2 }} />
              <input value={form.accent_color} onChange={(event) => setForm({ ...form, accent_color: event.target.value })} style={{ flex: 1 }} />
            </div>
          </label>
          <label>
            Secondary color
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="color" value={form.secondary_color} onChange={(event) => setForm({ ...form, secondary_color: event.target.value })} style={{ width: 44, height: 36, padding: 2 }} />
              <input value={form.secondary_color} onChange={(event) => setForm({ ...form, secondary_color: event.target.value })} style={{ flex: 1 }} />
            </div>
          </label>
          <label className="span-two">
            Logo
            <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 6 }}>
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Shop logo" style={{ maxHeight: 64, maxWidth: 220, objectFit: "contain", background: "#fff", borderRadius: 8, padding: 6, border: "1px solid var(--line)" }} />
              ) : (
                <div className="muted" style={{ fontSize: 13 }}>No logo uploaded — documents will show your business name as text.</div>
              )}
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadLogo(file);
                  event.target.value = "";
                }}
              />
              <button type="button" className="button secondary" disabled={logoUploading} onClick={() => logoInputRef.current?.click()}>
                {logoUploading ? "Working…" : logoUrl ? "Replace logo" : "Upload logo"}
              </button>
              {logoUrl && (
                <button type="button" className="button ghost" disabled={logoUploading} onClick={() => void removeLogo()}>Remove</button>
              )}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>PNG, JPG, WEBP, or SVG. Shown on estimates, work orders, invoices, and customer emails.</p>
          </label>
        </div>
      </div>

      {isOwner && <BillingPanel settings={initialSettings} />}

      <PaymentsPanel
        ownerId={ownerId}
        settings={initialSettings}
        pendingStripeOAuthCode={pendingStripeOAuthCode}
        onStripeOAuthCodeHandled={onStripeOAuthCodeHandled}
        stripeReturnPending={stripeReturnPending}
        onStripeReturnHandled={onStripeReturnHandled}
        onStatusChanged={onStripeStatusChanged}
      />

      <div className="panel settings-panel">
        <h2 style={{ marginTop: 0 }}>Staff accounts</h2>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.team_features_enabled}
            onChange={(event) => setForm({ ...form, team_features_enabled: event.target.checked })}
          />
          <span>
            <strong>Enable technician &amp; service advisor logins</strong>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
              Turn this on to invite technicians and service advisors with their own logins and assign them work.
              Leave it off if you&apos;re running this shop solo — nothing changes for you.
            </p>
          </span>
        </label>
        {form.team_features_enabled && (
          <label className="checkbox-row" style={{ marginTop: 14 }}>
            <input
              type="checkbox"
              checked={form.techs_can_price}
              onChange={(event) => setForm({ ...form, techs_can_price: event.target.checked })}
            />
            <span>
              <strong>Technicians can price the parts they add</strong>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                Technicians never see or change the labor rate or parts markup. This only controls whether they can enter a price on parts they log.
              </p>
            </span>
          </label>
        )}
      </div>

      {form.team_features_enabled && <StaffTeamsManager ownerId={ownerId} />}

      <p className="muted" style={{ textAlign: "center", fontSize: 12, marginTop: 4 }}>
        <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
        {" · "}
        <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
      </p>
    </section>
  );
}

function StaffTeamsManager({ ownerId }: { ownerId: string }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [newTeamName, setNewTeamName] = useState("");
  const [teamBusy, setTeamBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteForm, setInviteForm] = useState<{ name: string; email: string; username: string; employeeId: string; role: StaffRole; teamId: string; canViewAllWork: boolean; isAdmin: boolean }>({
    name: "", email: "", username: "", employeeId: "", role: "technician", teamId: "", canViewAllWork: false, isAdmin: false,
  });
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; username: string; password: string; emailSent: boolean } | null>(null);
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");

  useEffect(() => {
    const value = inviteForm.username.trim();
    if (!value) {
      setUsernameStatus("idle");
      return;
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(value)) {
      setUsernameStatus("invalid");
      return;
    }
    setUsernameStatus("checking");
    const handle = setTimeout(async () => {
      try {
        const response = await fetch("/.netlify/functions/check-username", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: value }),
        });
        const body = await response.json() as { available?: boolean };
        setUsernameStatus(body.available ? "available" : "taken");
      } catch {
        setUsernameStatus("idle");
      }
    }, 450);
    return () => clearTimeout(handle);
  }, [inviteForm.username]);

  async function loadAll() {
    setLoading(true);
    const [teamsResult, staffResult] = await Promise.all([
      supabase.from("teams").select("*").order("name"),
      supabase.from("staff").select("*").order("name"),
    ]);
    if (teamsResult.error) setMessage(teamsResult.error.message);
    else if (staffResult.error) setMessage(staffResult.error.message);
    setTeams((teamsResult.data ?? []) as Team[]);
    setStaff((staffResult.data ?? []) as StaffMember[]);
    setLoading(false);
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addTeam() {
    const name = newTeamName.trim();
    if (!name) return;
    setTeamBusy(true);
    setMessage("");
    const { error } = await supabase.from("teams").insert({ name, owner_id: ownerId });
    if (error) setMessage(error.message);
    else setNewTeamName("");
    await loadAll();
    setTeamBusy(false);
  }

  async function deleteTeam(id: string) {
    setTeamBusy(true);
    const { error } = await supabase.from("teams").delete().eq("id", id);
    if (error) setMessage(error.message);
    await loadAll();
    setTeamBusy(false);
  }

  async function updateStaff(id: string, patch: Partial<StaffMember>) {
    setMessage("");
    const { error } = await supabase.from("staff").update(patch).eq("id", id);
    if (error) setMessage(error.message);
    await loadAll();
  }

  async function inviteStaff() {
    const name = inviteForm.name.trim();
    const email = inviteForm.email.trim();
    const username = inviteForm.username.trim();
    if (!name || !email) {
      setMessage("Enter a name and email.");
      return;
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      setMessage("Username must be 3-20 characters, letters/numbers/underscore only.");
      return;
    }
    if (usernameStatus === "taken") {
      setMessage("That username is already taken. Try another.");
      return;
    }
    setInviteBusy(true);
    setMessage("");
    setCreatedCredentials(null);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/.netlify/functions/invite-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          name, email, username, role: inviteForm.role,
          employeeId: inviteForm.employeeId.trim() || null,
          teamId: inviteForm.teamId || null,
          canViewAllWork: inviteForm.canViewAllWork,
          isAdmin: inviteForm.isAdmin,
        }),
      });
      const body = await response.json() as { error?: string; tempPassword?: string; emailSent?: boolean };
      if (!response.ok) throw new Error(body.error || "Could not create the staff account.");
      setCreatedCredentials({ email, username, password: body.tempPassword || "", emailSent: Boolean(body.emailSent) });
      setInviteForm({ name: "", email: "", username: "", employeeId: "", role: "technician", teamId: "", canViewAllWork: false, isAdmin: false });
      setUsernameStatus("idle");
      await loadAll();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not create the staff account.");
    } finally {
      setInviteBusy(false);
    }
  }

  async function removeStaff(id: string) {
    if (!confirm("Remove this staff member? Their login will be deleted.")) return;
    setMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/.netlify/functions/remove-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ staffId: id }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not remove that staff member.");
      await loadAll();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not remove that staff member.");
    }
  }

  return (
    <>
      <div className="panel settings-panel">
        <h2 style={{ marginTop: 0 }}>Teams</h2>
        <p className="muted" style={{ marginTop: -6, fontSize: 13 }}>Optional. Group technicians together — useful for larger shops, skip it if you don&apos;t need it.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {teams.map((team) => (
            <span key={team.id} className="badge neutral" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              {team.name}
              <button type="button" className="button ghost small" disabled={teamBusy} onClick={() => void deleteTeam(team.id)} style={{ padding: "2px 6px" }}>✕</button>
            </span>
          ))}
          {!teams.length && <span className="muted" style={{ fontSize: 13 }}>No teams yet.</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input placeholder="New team name" value={newTeamName} onChange={(event) => setNewTeamName(event.target.value)} style={{ flex: 1 }} />
          <button type="button" className="button secondary" disabled={teamBusy || !newTeamName.trim()} onClick={() => void addTeam()}>Add team</button>
        </div>
      </div>

      <div className="panel settings-panel">
        <h2 style={{ marginTop: 0 }}>Staff</h2>
        {message && <div className="notice">{message}</div>}
        {createdCredentials && (
          <div className="notice" style={{ background: "#edf4ff", borderColor: "var(--blue)" }}>
            <strong>Account created for {createdCredentials.username}</strong>
            <p style={{ margin: "6px 0" }}>
              {createdCredentials.emailSent
                ? <>Also emailed to {createdCredentials.email}. They&apos;ll log in with this username and temporary password (copy it now, just in case — it won&apos;t be shown again):</>
                : <>Could not email this to {createdCredentials.email} — copy the password now and hand it to them directly (it won&apos;t be shown again):</>}
            </p>
            <p style={{ margin: "4px 0" }}>Username: <code style={{ fontSize: 16, fontWeight: 700, userSelect: "all" }}>{createdCredentials.username}</code></p>
            <p style={{ margin: "4px 0" }}>Password: <code style={{ fontSize: 16, fontWeight: 700, userSelect: "all" }}>{createdCredentials.password}</code></p>
            <p className="muted" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
              Their real email ({createdCredentials.email}) is only used if they need to reset a forgotten password. They can change their password after signing in.
            </p>
            <button type="button" className="button ghost small" style={{ marginTop: 8 }} onClick={() => setCreatedCredentials(null)}>Dismiss</button>
          </div>
        )}

        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="table-wrap" style={{ marginBottom: 20 }}>
            <table>
              <thead>
                <tr><th>Name</th><th>Username</th><th>ID</th><th>Email</th><th>Role</th><th>Team</th><th>Sees</th><th>Admin</th><th>Active</th><th></th></tr>
              </thead>
              <tbody>
                {staff.map((member) => (
                  <tr key={member.id}>
                    <td>{member.name}</td>
                    <td>
                      <input
                        defaultValue={member.username || ""}
                        placeholder="—"
                        style={{ width: 110 }}
                        onBlur={(event) => {
                          const value = event.target.value.trim() || null;
                          if (value && !/^[a-zA-Z0-9_]{3,20}$/.test(value)) {
                            setMessage("Username must be 3-20 characters, letters/numbers/underscore only.");
                            return;
                          }
                          if (value !== member.username) void updateStaff(member.id, { username: value });
                        }}
                      />
                    </td>
                    <td>
                      <input
                        defaultValue={member.employee_id || ""}
                        placeholder="—"
                        style={{ width: 90 }}
                        onBlur={(event) => {
                          const value = event.target.value.trim() || null;
                          if (value !== member.employee_id) void updateStaff(member.id, { employee_id: value });
                        }}
                      />
                    </td>
                    <td>{member.email}</td>
                    <td>
                      <select value={member.role} onChange={(event) => void updateStaff(member.id, { role: event.target.value as StaffRole })}>
                        <option value="technician">Technician</option>
                        <option value="service_advisor">Service advisor</option>
                      </select>
                    </td>
                    <td>
                      <select value={member.team_id || ""} onChange={(event) => void updateStaff(member.id, { team_id: event.target.value || null })}>
                        <option value="">No team</option>
                        {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={member.can_view_all_work ? "all" : "own"} onChange={(event) => void updateStaff(member.id, { can_view_all_work: event.target.value === "all" })}>
                        <option value="own">{member.role === "technician" ? "Assigned jobs only" : "Their own ROs only"}</option>
                        <option value="all">All shop work</option>
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`button small ${member.is_admin ? "primary" : "ghost"}`}
                        title="Full admin access: same as the owner — Settings, branding, and staff management."
                        onClick={() => void updateStaff(member.id, { is_admin: !member.is_admin })}
                      >
                        {member.is_admin ? "Master" : "Staff"}
                      </button>
                    </td>
                    <td>
                      <button type="button" className={`button small ${member.active ? "secondary" : "warning"}`} onClick={() => void updateStaff(member.id, { active: !member.active })}>
                        {member.active ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td>
                      <button type="button" className="button small danger" onClick={() => void removeStaff(member.id)}>Remove</button>
                    </td>
                  </tr>
                ))}
                {!staff.length && <tr><td colSpan={10} className="empty-state">No staff added yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        <h3>Add staff</h3>
        <div className="form-grid two">
          <label>
            Name
            <input value={inviteForm.name} onChange={(event) => setInviteForm({ ...inviteForm, name: event.target.value })} />
          </label>
          <label>
            Email <span className="muted" style={{ fontWeight: 400 }}>(for password resets only — not used to log in)</span>
            <input type="email" value={inviteForm.email} onChange={(event) => setInviteForm({ ...inviteForm, email: event.target.value })} />
          </label>
          <label>
            Username <span className="muted" style={{ fontWeight: 400 }}>(what they&apos;ll type to log in)</span>
            <input
              value={inviteForm.username}
              onChange={(event) => setInviteForm({ ...inviteForm, username: event.target.value })}
              placeholder="e.g. Bobert12"
              maxLength={20}
              style={
                usernameStatus === "taken" || usernameStatus === "invalid"
                  ? { borderColor: "var(--red, #c0392b)" }
                  : usernameStatus === "available"
                    ? { borderColor: "var(--green, #2e7d32)" }
                    : undefined
              }
            />
            {usernameStatus === "checking" && <span className="muted" style={{ fontSize: 12 }}>Checking…</span>}
            {usernameStatus === "available" && <span style={{ fontSize: 12, color: "var(--green, #2e7d32)" }}>✓ Available</span>}
            {usernameStatus === "taken" && <span style={{ fontSize: 12, color: "var(--red, #c0392b)" }}>✗ Already taken — try another</span>}
            {usernameStatus === "invalid" && <span style={{ fontSize: 12, color: "var(--red, #c0392b)" }}>3-20 characters, letters/numbers/underscore only</span>}
          </label>
          <label>
            Employee ID (optional)
            <input value={inviteForm.employeeId} onChange={(event) => setInviteForm({ ...inviteForm, employeeId: event.target.value })} />
          </label>
          <label>
            Role
            <select value={inviteForm.role} onChange={(event) => setInviteForm({ ...inviteForm, role: event.target.value as StaffRole })}>
              <option value="technician">Technician</option>
              <option value="service_advisor">Service advisor</option>
            </select>
          </label>
          <label>
            Team (optional)
            <select value={inviteForm.teamId} onChange={(event) => setInviteForm({ ...inviteForm, teamId: event.target.value })}>
              <option value="">No team</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          <label className="checkbox-row span-two">
            <input
              type="checkbox"
              checked={inviteForm.canViewAllWork}
              onChange={(event) => setInviteForm({ ...inviteForm, canViewAllWork: event.target.checked })}
            />
            <span>Can see all shop work (not just their own assigned/created work)</span>
          </label>
          <label className="checkbox-row span-two">
            <input
              type="checkbox"
              checked={inviteForm.isAdmin}
              onChange={(event) => setInviteForm({ ...inviteForm, isAdmin: event.target.checked })}
            />
            <span><strong>Full admin access (master account)</strong> — same as the owner: Settings, branding, and managing other staff. Use sparingly.</span>
          </label>
        </div>
        <button
          type="button"
          className="button primary"
          disabled={inviteBusy || usernameStatus === "taken" || usernameStatus === "invalid" || usernameStatus === "checking"}
          onClick={() => void inviteStaff()}
          style={{ marginTop: 12 }}
        >
          {inviteBusy ? "Creating…" : "Create staff account"}
        </button>
      </div>
    </>
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
  onPaid,
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
  onPaid: () => void;
}) {
  const [documentPhotos, setDocumentPhotos] = useState<EstimatePhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(true);
  const [photoError, setPhotoError] = useState("");
  const [printing, setPrinting] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentLink, setPaymentLink] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [zelleBusy, setZelleBusy] = useState(false);
  const [zelleLink, setZelleLink] = useState("");
  const [zelleError, setZelleError] = useState("");
  const [pendingZellePayment, setPendingZellePayment] = useState<{ id: string; amount: number; status: string } | null>(null);
  const [zelleConfirmBusy, setZelleConfirmBusy] = useState(false);
  const [zelleConfirmNote, setZelleConfirmNote] = useState("");
  const [invoiceEmailBusy, setInvoiceEmailBusy] = useState(false);
  const [invoiceEmailMessage, setInvoiceEmailMessage] = useState("");
  const documentRef = useRef<HTMLElement>(null);

  async function emailInvoiceNow() {
    setInvoiceEmailBusy(true);
    setInvoiceEmailMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/.netlify/functions/send-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ repairOrderId: ro.id }),
      });
      const body = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "The invoice could not be emailed.");
      setInvoiceEmailMessage(body.message || "Invoice emailed.");
    } catch (caught) {
      setInvoiceEmailMessage(caught instanceof Error ? caught.message : "The invoice could not be emailed.");
    } finally {
      setInvoiceEmailBusy(false);
    }
  }

  async function collectPayment() {
    setPaymentBusy(true);
    setPaymentError("");
    setPaymentLink("");
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/.netlify/functions/create-payment-session", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ repairOrderId: ro.id }),
      });
      const body = await response.json() as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error || "Could not start a payment.");
      setPaymentLink(body.url);
    } catch (caught) {
      setPaymentError(caught instanceof Error ? caught.message : "Could not start a payment.");
    } finally {
      setPaymentBusy(false);
    }
  }

  async function requestZellePayment() {
    setZelleBusy(true);
    setZelleError("");
    setZelleLink("");
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/.netlify/functions/request-zelle-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ repairOrderId: ro.id }),
      });
      const body = await response.json() as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error || "Could not create a Zelle payment link.");
      setZelleLink(body.url);
    } catch (caught) {
      setZelleError(caught instanceof Error ? caught.message : "Could not create a Zelle payment link.");
    } finally {
      setZelleBusy(false);
    }
  }

  async function confirmZellePayment() {
    if (!pendingZellePayment) return;
    setZelleConfirmBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/.netlify/functions/confirm-zelle-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ paymentId: pendingZellePayment.id, note: zelleConfirmNote }),
      });
      const body = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not confirm the payment.");
      setPendingZellePayment(null);
      onPaid();
    } catch (caught) {
      setZelleError(caught instanceof Error ? caught.message : "Could not confirm the payment.");
    } finally {
      setZelleConfirmBusy(false);
    }
  }

  const isEstimate = mode === "estimate";
  const isWorkOrder = mode === "work_order";
  const isInvoice = mode === "invoice";

  // Surface any not-yet-confirmed Zelle payment for this invoice so staff see it the moment they
  // open it, without having to remember to check. RLS already scopes this to the caller's own shop.
  useEffect(() => {
    let cancelled = false;
    if (!isInvoice) return;
    supabase
      .from("payments")
      .select("id,amount,status")
      .eq("repair_order_id", ro.id)
      .eq("processor", "zelle")
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (cancelled) return;
        const row = data?.[0] as { id: string; amount: number; status: string } | undefined;
        setPendingZellePayment(row ? { id: row.id, amount: Number(row.amount), status: row.status } : null);
      });
    return () => {
      cancelled = true;
    };
  }, [isInvoice, ro.id, zelleLink]);

  useEffect(() => {
    let cancelled = false;
    setDocumentPhotos([]);
    setPhotosLoading(true);
    setPhotoError("");
    async function loadDocumentPhotos() {
      try {
        const { data, error } = await supabase.from("estimate_photos").select("*")
          .eq("repair_order_id", ro.id).order("sort_order").order("created_at");
        if (error) throw error;
        const photos = await Promise.all(((data ?? []) as EstimatePhoto[]).map(async (photo) => {
          const result = await supabase.storage.from("estimate-photos").createSignedUrl(photo.storage_path, 3600);
          if (result.error) throw result.error;
          return { ...photo, signed_url: result.data?.signedUrl };
        }));
        if (!cancelled) setDocumentPhotos(photos);
      } catch {
        if (!cancelled) setPhotoError("Photos could not be loaded. Reopen this document to try again before printing.");
      } finally {
        if (!cancelled) setPhotosLoading(false);
      }
    }
    void loadDocumentPhotos();
    return () => { cancelled = true; };
  }, [ro.id]);

  async function printDocument() {
    setPrinting(true);
    try {
      const images = Array.from(documentRef.current?.querySelectorAll("img") ?? []);
      await Promise.all(images.map((image) => image.decode()));
      window.print();
    } catch {
      setPhotoError("An image could not be loaded. Reopen this document and try printing again.");
    } finally {
      setPrinting(false);
    }
  }

  const items = ro.line_items ?? [];
  const customer = ro.customers;
  const vehicle = ro.vehicles;
  const authorization = ro.latest_estimate_authorization;
  const decisions = authorization?.line_decisions ?? {};
  const hasCustomerResponse = hasAuthorizationResponse(authorization);
  const decisionSummary = authorizationDecisionSummary(authorization);
  const pricedItems = isEstimate ? items : authorizedLineItems(items, authorization, ro.invoice_overrides);
  const { subtotal, tax, total } = calculateLineItemTotals(pricedItems, Number(ro.tax_rate));
  const declinedGroups = isInvoice ? declinedEstimateGroups(authorization).filter((group) => !ro.invoice_overrides?.[group.id]) : [];
  const currentStatusLabel = statusLabel(ro.status);
  const displayedItems = isInvoice && hasCustomerResponse ? pricedItems : items;
  const groupedDocumentItems = (() => {
    const groups: Array<{ id: string; title: string; recommendation: string; workPerformed: string; items: LineItem[] }> = [];
    const byId = new Map<string, { id: string; title: string; recommendation: string; workPerformed: string; items: LineItem[] }>();
    for (const item of displayedItems) {
      if (!item.service_group_id) {
        groups.push({ id: `line-${item.id}`, title: "", recommendation: "", workPerformed: "", items: [item] });
        continue;
      }
      let group = byId.get(item.service_group_id);
      if (!group) {
        group = {
          id: item.service_group_id,
          title: item.service_group_title || "Service Job",
          recommendation: item.technician_story || "",
          workPerformed: item.work_performed || "",
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
        <div className="workspace-actions">
          <div className="button-row button-row-muted">
            {!ro.archived_at && <button className="button ghost" onClick={onEdit}>Edit Work Order</button>}
            <button className="button ghost" onClick={onInspection}>Multipoint Inspection</button>
            <button className="button ghost" onClick={onArchive}>
              {ro.archived_at ? "Restore" : "Archive"}
            </button>
            <button className={`button ghost ${ro.status === "voided" ? "" : "warning-text"}`} onClick={onVoid}>
              {ro.status === "voided" ? "Reopen" : "Void"}
            </button>
            <button className="button ghost danger-text" onClick={onDelete}>Delete permanently</button>
          </div>
          <div className="button-row">
            {isInvoice && ro.status !== "voided" && (
              <button className="button secondary" disabled={invoiceEmailBusy} onClick={() => void emailInvoiceNow()}>
                {invoiceEmailBusy ? "Sending…" : "Email Invoice"}
              </button>
            )}
            {isInvoice && !ro.paid && ro.status !== "voided" && settings.stripe_charges_enabled && settings.subscription_status !== "trialing" && (
              <button className="button success" disabled={paymentBusy} onClick={() => void collectPayment()}>
                {paymentBusy ? "Starting…" : "Collect payment"}
              </button>
            )}
            {isInvoice && !ro.paid && ro.status !== "voided" && settings.zelle_recipient && settings.subscription_status !== "trialing" && (
              <button className="button secondary" disabled={zelleBusy} onClick={() => void requestZellePayment()}>
                {zelleBusy ? "Starting…" : "Request Zelle payment"}
              </button>
            )}
            <button className="button primary" disabled={photosLoading || printing || Boolean(photoError)} onClick={() => void printDocument()}>{photosLoading || printing ? "Loading images…" : "Print / Save PDF"}</button>
          </div>
        </div>
      </div>
      {invoiceEmailMessage && (
        <div className={`no-print ${invoiceEmailMessage.toLowerCase().includes("emailed") ? "notice" : "error-banner"}`} style={{ margin: "0 0 16px" }}>
          <span>{invoiceEmailMessage}</span>
        </div>
      )}
      {(paymentLink || paymentError) && (
        <div className={`no-print ${paymentError ? "error-banner" : "notice"}`} style={{ margin: "0 0 16px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {paymentError ? (
            <span>{paymentError}</span>
          ) : (
            <>
              <span>Payment link ready — copy it to the customer, or open it to take payment right now:</span>
              <input readOnly value={paymentLink} onFocus={(event) => event.target.select()} style={{ flex: "1 1 320px", minWidth: 220 }} />
              <button type="button" className="button secondary" onClick={() => void navigator.clipboard.writeText(paymentLink)}>Copy link</button>
              <a className="button primary" href={paymentLink} target="_blank" rel="noopener noreferrer">Open</a>
            </>
          )}
        </div>
      )}
      {(zelleLink || zelleError) && (
        <div className={`no-print ${zelleError ? "error-banner" : "notice"}`} style={{ margin: "0 0 16px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {zelleError ? (
            <span>{zelleError}</span>
          ) : (
            <>
              <span>Zelle payment link ready — send it to the customer. <strong>You&apos;ll still need to confirm payment yourself</strong> once it arrives in your bank account.</span>
              <input readOnly value={zelleLink} onFocus={(event) => event.target.select()} style={{ flex: "1 1 320px", minWidth: 220 }} />
              <button type="button" className="button secondary" onClick={() => void navigator.clipboard.writeText(zelleLink)}>Copy link</button>
              <a className="button primary" href={zelleLink} target="_blank" rel="noopener noreferrer">Open</a>
            </>
          )}
        </div>
      )}
      {pendingZellePayment && (
        <div className="no-print notice" style={{ margin: "0 0 16px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: "#fff7e6", borderColor: "#f0b429" }}>
          <span>
            {pendingZellePayment.status === "processing" ? (
              <>Customer says they sent <strong>{pendingZellePayment.amount.toLocaleString("en-US", { style: "currency", currency: "usd" })}</strong> via Zelle. <strong>Nothing is marked paid until you confirm it below</strong> — check your bank app first.</>
            ) : (
              <>A Zelle payment link for <strong>{pendingZellePayment.amount.toLocaleString("en-US", { style: "currency", currency: "usd" })}</strong> is awaiting the customer. You can still confirm it manually below once the money arrives.</>
            )}
          </span>
          <input
            placeholder="Optional note (e.g. last 4 of transfer)"
            value={zelleConfirmNote}
            onChange={(event) => setZelleConfirmNote(event.target.value)}
            style={{ flex: "1 1 220px", minWidth: 180 }}
          />
          <button type="button" className="button success" disabled={zelleConfirmBusy} onClick={() => void confirmZellePayment()}>
            {zelleConfirmBusy ? "Confirming…" : "Confirm payment received"}
          </button>
        </div>
      )}
      <article ref={documentRef} className={`document-page ${className} ${ro.status === "voided" ? "voided-document" : ""}`}>
        {ro.status === "voided" && <div className="void-watermark">VOID</div>}

        <header className="document-header">
          <div>
            {logoPublicUrl(settings.logo_path) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="document-logo" src={logoPublicUrl(settings.logo_path) ?? undefined} alt={settings.business_name} />
            ) : (
              <h2 className="document-logo-text">{settings.business_name}</h2>
            )}
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

        {!isEstimate && hasCustomerResponse && (
          <section className={`document-authorization-summary ${authorization?.status}`}>
            <div><span>Customer authorization</span><strong>{authorization?.status.replaceAll("_", " ")}</strong></div>
            <div><span>Authorized amount</span><strong>{money(Number(authorization?.approved_total || 0))}</strong></div>
            {authorization?.responded_at && <div><span>Response received</span><strong>{new Date(authorization.responded_at).toLocaleString()}</strong></div>}
            <div className="document-decision-breakdown">
              <section className="approved">
                <span>✓ Approved ({decisionSummary.approved.length})</span>
                <strong>{decisionSummary.approved.length ? decisionSummary.approved.join(" · ") : "None"}</strong>
              </section>
              <section className="declined">
                <span>✕ Declined ({decisionSummary.declined.length})</span>
                <strong>{decisionSummary.declined.length ? decisionSummary.declined.join(" · ") : "None"}</strong>
              </section>
            </div>
          </section>
        )}

        {isEstimate ? (
          <div className="estimate-service-cards">
            {groupedDocumentItems.map((group) => {
              const isServiceJob = Boolean(group.title);
              const jobTotal = group.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
              if (!isServiceJob) return null;
              return (
                <section className="estimate-service-card" key={group.id}>
                  <header><div><span>Recommended service</span><h3>{group.title}</h3></div><strong>{money(jobTotal)}</strong></header>
                  {group.recommendation && <p className="estimate-recommendation">{group.recommendation}</p>}
                  <details className="estimate-breakdown" open>
                    <summary>Parts and labor breakdown</summary>
                    <table className="document-table">
                      <thead><tr><th>Description</th><th>Qty/Hrs</th><th>Est. Rate/Price</th><th>Amount</th></tr></thead>
                      <tbody>{group.items.map((item) => (
                        <tr key={item.id} className={item.item_type === "discount" ? "document-discount-row" : undefined}><td>{item.description}</td><td>{item.quantity}</td><td>{money(item.item_type === "discount" ? Math.abs(item.unit_price) : item.unit_price)}</td><td>{money(item.quantity * item.unit_price)}</td></tr>
                      ))}</tbody>
                    </table>
                  </details>
                </section>
              );
            })}
            {groupedDocumentItems.some((group) => !group.title) && (
              <section className="estimate-service-card additional-charges">
                <header><div><span>Estimate details</span><h3>Additional charges and discounts</h3></div></header>
                <table className="document-table">
                  <thead><tr><th>Description</th><th>Qty</th><th>Rate/Price</th><th>Amount</th></tr></thead>
                  <tbody>{groupedDocumentItems.filter((group) => !group.title).flatMap((group) => group.items).map((item) => (
                    <tr key={item.id} className={item.item_type === "discount" ? "document-discount-row" : undefined}><td>{item.description}</td><td>{item.quantity}</td><td>{money(item.item_type === "discount" ? Math.abs(item.unit_price) : item.unit_price)}</td><td>{money(item.quantity * item.unit_price)}</td></tr>
                  ))}</tbody>
                </table>
              </section>
            )}
          </div>
        ) : <table className="document-table">
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
              const separateAuthorization = ro.invoice_overrides?.[group.id];
              const decision = isServiceJob && hasCustomerResponse && !separateAuthorization ? decisions[group.id] : undefined;
              return [
                isServiceJob && (
                  <tr className={`document-job-heading ${decision ? `authorization-${decision}` : ""}`} key={`${group.id}-heading`}>
                    <td colSpan={4}>
                      <div className="document-job-title"><strong>{group.title}</strong>{decision && <span className={`authorization-mark ${decision}`}>{decision}</span>}</div>
                      {isWorkOrder && group.recommendation && <p><span>Authorized scope:</span> {group.recommendation}</p>}
                      {isInvoice && separateAuthorization && <p><span>Separately authorized:</span> {separateAuthorization.note}</p>}
                      {isInvoice && group.workPerformed && <p><span>Work performed:</span> {group.workPerformed}</p>}
                    </td>
                    <td><strong>{money(jobTotal)}</strong></td>
                  </tr>
                ),
                ...group.items.map((item) => (
                  <tr key={item.id} className={`${item.item_type === "discount" ? "document-discount-row" : item.item_type === "part" && isServiceJob ? "document-associated-part" : ""} ${decision === "declined" ? "authorization-declined-line" : ""}`}>
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
        </table>}

        {isInvoice && declinedGroups.length > 0 && (
          <section className="invoice-declined-work">
            <header>
              <div>
                <span>Customer declined</span>
                <h3>Not authorized / not charged</h3>
              </div>
              <strong>{declinedGroups.length} declined job{declinedGroups.length === 1 ? "" : "s"}</strong>
            </header>
            <p>These recommendations were included on the estimate and declined by the customer. They are excluded from the invoice total.</p>
            <div className="invoice-declined-list">
              {declinedGroups.map((group) => {
                const groupTotal = group.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
                const descriptions = group.items.map((item) => item.description).filter(Boolean).join(" · ");
                return (
                  <div className="invoice-declined-job" key={group.id}>
                    <div>
                      <strong>{group.title}</strong>
                      {descriptions && <small>{descriptions}</small>}
                    </div>
                    <span>Declined</span>
                    <b>{money(groupTotal)} not charged</b>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {photoError && <p className="message error" role="alert">{photoError}</p>}
        {documentPhotos.length > 0 && (
          <section className="document-photos">
            <h3>Service photos</h3>
            <div className="document-photo-grid">
              {documentPhotos.map((photo) => {
                const service = items.find((item) => item.service_group_id === photo.service_group_id);
                const declined = hasCustomerResponse && decisions[photo.service_group_id] === "declined" && !ro.invoice_overrides?.[photo.service_group_id];
                return <figure className="document-photo" key={photo.id}>
                  <img src={photo.signed_url} alt={photo.caption || service?.service_group_title || "Service photo"} loading="eager" />
                  <figcaption>
                    <strong>{service?.service_group_title || "Service photo"}{declined ? " — Declined / not charged" : ""}</strong>
                    {photo.caption && <span>{photo.caption}</span>}
                  </figcaption>
                </figure>;
              })}
            </div>
          </section>
        )}

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
          </section>
        )}

        {isWorkOrder && (
          <section className="document-terms repair-order-terms">
            <strong>Work authorization</strong>
            <p>Customer authorizes Allegiant Auto Care to perform the work listed above and acknowledges that additional work requires further approval.</p>
          </section>
        )}

        {isInvoice && (
          <>
            {authorization?.signature_data && (
              <section className="invoice-authorization-signature">
                <div>
                  <span>Original estimate authorization signature</span>
                  <strong>{authorization.customer_name || customer?.name || "Customer"}</strong>
                  {authorization.responded_at && <small>Signed {new Date(authorization.responded_at).toLocaleString()}</small>}
                  <small>Authorized amount: {money(Number(authorization.approved_total || 0))}</small>
                </div>
                <img src={authorization.signature_data} alt={`Approval signature for ${authorization.customer_name || customer?.name || "customer"}`} />
              </section>
            )}
            <footer className="document-footer">
              <strong>{ro.paid ? "PAID IN FULL" : "PAYMENT DUE UPON COMPLETION"}</strong>
              <p>{settings.invoice_footer}</p>
            </footer>
          </>
        )}
      </article>
    </section>
  );
}
