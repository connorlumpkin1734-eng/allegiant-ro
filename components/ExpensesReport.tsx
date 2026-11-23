"use client";
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

// ===================== Expenses =====================
// Card statements (Wells Fargo or any bank's CSV) are imported, sorted into categories by the shop's
// rules, and set against paid sales so the month shows real profit. Owner/admin only (Reports).

export const EXPENSE_CATEGORIES = [
  "Parts & Materials",
  "Equipment & Tools",
  "Rent",
  "Utilities",
  "Insurance",
  "Professional Services",
  "Software & Subscriptions",
  "Marketing",
  "Fuel & Vehicle",
  "Shop Supplies",
  "Other",
  "Uncategorized",
] as const;

// Used only when none of the shop's own rules match. The shop's rules always win.
const BUILT_IN_RULES: Array<[string, string]> = [
  ["OREILLY", "Parts & Materials"],
  ["O'REILLY", "Parts & Materials"],
  ["AUTOZONE", "Parts & Materials"],
  ["ADVANCE AUTO", "Parts & Materials"],
  ["NAPA", "Parts & Materials"],
  ["PARTSTECH", "Parts & Materials"],
  ["NETLIFY", "Software & Subscriptions"],
  ["SUPABASE", "Software & Subscriptions"],
  ["ALLDATA", "Software & Subscriptions"],
  ["GOOGLE", "Software & Subscriptions"],
  ["STATE FARM", "Insurance"],
  ["PROGRESSIVE", "Insurance"],
  ["FEDERATED", "Insurance"],
  ["SHELL", "Fuel & Vehicle"],
  ["EXXON", "Fuel & Vehicle"],
  ["CHEVRON", "Fuel & Vehicle"],
  ["QT ", "Fuel & Vehicle"],
  ["QUIKTRIP", "Fuel & Vehicle"],
  ["RACETRAC", "Fuel & Vehicle"],
];

type Expense = {
  id: string;
  owner_id: string;
  expense_date: string;
  description: string;
  amount: number;
  category: string;
  payment_method: string;
  repair_order_id: string | null;
  notes: string | null;
  source: "manual" | "import";
  import_key: string | null;
};
type Rule = { id: string; owner_id: string; match_text: string; category: string };
export type ExpenseRoOption = { id: string; label: string };
export type MonthSales = { key: string; sales: number; fees: number };

type ImportRow = {
  key: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // positive = money out
  category: string;
  include: boolean;
  duplicate: boolean;
};

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number.isFinite(value) ? value : 0);
const pad2 = (n: number) => String(n).padStart(2, "0");
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const monthLabel = (key: string) => { const [y, m] = key.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }); };
const shortDate = (key: string) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" }); };

function categorize(description: string, rules: Rule[]): string {
  const text = description.toUpperCase();
  // Longest match first, so "OREILLY BATTERY" can beat "OREILLY" if the shop sets both.
  const own = [...rules].sort((a, b) => b.match_text.length - a.match_text.length).find((rule) => text.includes(rule.match_text.toUpperCase()));
  if (own) return own.category;
  return BUILT_IN_RULES.find(([match]) => text.includes(match))?.[1] ?? "Uncategorized";
}

/** First real word of a statement line: "OREILLY 1234 DALLAS TX" -> "OREILLY". Used to suggest a rule. */
function suggestKeyword(description: string): string {
  const words = description.toUpperCase().replace(/[^A-Z0-9' &]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !["THE", "SQ", "TST", "POS", "PURCHASE", "AUTHORIZED", "RECURRING", "PAYMENT"].includes(w));
  return words[0] ?? description.trim().slice(0, 12).toUpperCase();
}

// ---- CSV ----
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

function toDateKey(value: string): string | null {
  const v = value.trim();
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return `${y}-${pad2(+m[1])}-${pad2(+m[2])}`; }
  return null;
}
function toNumber(value: string): number | null {
  const v = value.replace(/[$,\s]/g, "");
  if (!v) return null;
  const negative = /^\(.*\)$/.test(v) || v.startsWith("-");
  const n = Number(v.replace(/[()\-+]/g, ""));
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

/**
 * Reads a card statement CSV into rows where amount > 0 means money spent.
 * - Wells Fargo: no header, columns "date","amount","*","","description"; purchases are negative.
 * - Anything with a header row: finds Date / Description / Amount (or Debit + Credit) columns.
 */
function readStatement(text: string): { rows: Array<Omit<ImportRow, "category" | "include" | "duplicate">>; error?: string } {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], error: "That file is empty." };
  const header = table[0].map((h) => h.toLowerCase());
  const hasHeader = header.some((h) => /date|description|amount|debit|merchant|payee/.test(h)) && !toDateKey(table[0][0] ?? "");
  const seen = new Map<string, number>();
  const out: Array<Omit<ImportRow, "category" | "include" | "duplicate">> = [];
  const push = (date: string, description: string, spent: number) => {
    const base = `${date}|${spent.toFixed(2)}|${description.toUpperCase()}`;
    const n = (seen.get(base) ?? 0) + 1; // two identical charges on the same day are both kept
    seen.set(base, n);
    out.push({ key: `${base}|${n}`, date, description, amount: spent });
  };

  if (!hasHeader) {
    // Wells Fargo style
    for (const r of table) {
      const date = toDateKey(r[0] ?? "");
      const amount = toNumber(r[1] ?? "");
      const description = (r[4] ?? r[r.length - 1] ?? "").replace(/\s+/g, " ").trim();
      if (!date || amount === null) continue;
      push(date, description, -amount);
    }
  } else {
    const find = (...names: RegExp[]) => header.findIndex((h) => names.some((re) => re.test(h)));
    const dateCol = find(/^(transaction |trans\.? |posted |post )?date$/, /date/);
    const descCol = find(/description/, /merchant/, /payee/, /name/, /memo/);
    const amountCol = find(/^amount/, /amount/);
    const debitCol = find(/debit/, /withdraw/, /charge/);
    const creditCol = find(/credit/, /deposit/, /payment/);
    if (dateCol < 0 || descCol < 0 || (amountCol < 0 && debitCol < 0)) {
      return { rows: [], error: "Couldn't find the date, description and amount columns in that file." };
    }
    const amounts: number[] = [];
    const parsed = table.slice(1).map((r) => {
      const date = toDateKey(r[dateCol] ?? "");
      const description = (r[descCol] ?? "").replace(/\s+/g, " ").trim();
      let amount: number | null;
      if (amountCol >= 0) amount = toNumber(r[amountCol] ?? "");
      else {
        const debit = toNumber(r[debitCol] ?? "") ?? 0;
        const credit = creditCol >= 0 ? toNumber(r[creditCol] ?? "") ?? 0 : 0;
        amount = Math.abs(debit) ? -Math.abs(debit) : Math.abs(credit);
      }
      if (amount !== null) amounts.push(amount);
      return { date, description, amount };
    });
    // Some banks show purchases as positive. If most lines are positive, flip so purchases count as spent.
    const positives = amounts.filter((a) => a > 0).length;
    const purchasesArePositive = amountCol >= 0 && positives > amounts.length / 2;
    for (const p of parsed) {
      if (!p.date || p.amount === null) continue;
      push(p.date, p.description, purchasesArePositive ? p.amount : -p.amount);
    }
  }
  if (!out.length) return { rows: [], error: "No transactions found in that file." };
  return { rows: out };
}

function looksLikePayment(description: string): boolean {
  return /ONLINE PAYMENT|AUTOMATIC PAYMENT|PAYMENT - THANK|PAYMENT THANK|AUTOPAY|ONLINE PYMT/i.test(description);
}

export function ExpensesReport({ ownerId, roOptions, monthSales }: { ownerId: string; roOptions: ExpenseRoOption[]; monthSales: (feeByRo: Map<string, number>) => MonthSales[] }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [feeByRo, setFeeByRo] = useState<Map<string, number>>(new Map());
  const [month, setMonth] = useState(() => todayKey().slice(0, 7));
  const [panel, setPanel] = useState<"none" | "import" | "add">("none");
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null);
  const [importMessage, setImportMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [rememberFor, setRememberFor] = useState<{ id: string; keyword: string } | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      supabase.from("expenses").select("*").eq("owner_id", ownerId).order("expense_date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("expense_rules").select("*").eq("owner_id", ownerId).order("match_text"),
      supabase.from("payments").select("repair_order_id,fee_amount").eq("status", "succeeded").not("fee_amount", "is", null),
    ]).then(([exp, rul, pay]) => {
      if (cancelled) return;
      if (exp.error) setLoadError(exp.error.message);
      setExpenses(((exp.data ?? []) as Expense[]).map((e) => ({ ...e, amount: Number(e.amount) })));
      setRules((rul.data ?? []) as Rule[]);
      const map = new Map<string, number>();
      for (const row of (pay.data ?? []) as Array<{ repair_order_id: string; fee_amount: number | string }>) {
        map.set(row.repair_order_id, (map.get(row.repair_order_id) ?? 0) + Number(row.fee_amount));
      }
      setFeeByRo(map);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [ownerId]);

  const salesByMonth = useMemo(() => new Map(monthSales(feeByRo).map((row) => [row.key, row])), [monthSales, feeByRo]);
  const months = useMemo(() => {
    const keys = new Set<string>([todayKey().slice(0, 7), month]);
    for (const e of expenses) keys.add(e.expense_date.slice(0, 7));
    for (const key of salesByMonth.keys()) if (/^\d{4}-\d{2}$/.test(key)) keys.add(key);
    return [...keys].sort().reverse();
  }, [expenses, salesByMonth, month]);

  const monthExpenses = useMemo(() => expenses.filter((e) => e.expense_date.startsWith(month)), [expenses, month]);
  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of monthExpenses) map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [monthExpenses]);
  const totalExpenses = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
  const sales = salesByMonth.get(month);
  const netProfit = (sales?.sales ?? 0) - (sales?.fees ?? 0) - totalExpenses;
  const uncategorized = monthExpenses.filter((e) => e.category === "Uncategorized").length;
  const shown = filter === "all" ? monthExpenses : monthExpenses.filter((e) => e.category === filter);
  const roLabel = useMemo(() => new Map(roOptions.map((o) => [o.id, o.label])), [roOptions]);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? "" : current)), 4000);
  }

  // ---- Import ----
  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportMessage("");
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") {
      setImportRows(null);
      setImportMessage("That's not a CSV file. In Wells Fargo, download your card activity as \"Comma Delimited\" (CSV), not PDF.");
      return;
    }
    const { rows, error } = readStatement(await file.text());
    if (error) { setImportRows(null); setImportMessage(error); return; }
    const existing = new Set(expenses.map((e) => e.import_key).filter(Boolean) as string[]);
    setImportRows(rows.map((row) => {
      const duplicate = existing.has(row.key);
      const isMoneyIn = row.amount <= 0;
      return { ...row, category: categorize(row.description, rules), duplicate, include: !duplicate && !isMoneyIn && !looksLikePayment(row.description) };
    }));
  }

  async function saveImport() {
    if (!importRows) return;
    const picked = importRows.filter((row) => row.include && !row.duplicate);
    if (!picked.length) return;
    setBusy(true);
    const payload = picked.map((row) => ({
      owner_id: ownerId,
      expense_date: row.date,
      description: row.description,
      amount: row.amount,
      category: row.category,
      payment_method: "Card",
      source: "import" as const,
      import_key: row.key,
    }));
    const { data, error } = await supabase.from("expenses").upsert(payload, { onConflict: "owner_id,import_key", ignoreDuplicates: true }).select("*");
    setBusy(false);
    if (error) { setImportMessage(`Couldn't save: ${error.message}`); return; }
    const added = ((data ?? []) as Expense[]).map((e) => ({ ...e, amount: Number(e.amount) }));
    setExpenses((current) => [...added, ...current].sort((a, b) => (a.expense_date < b.expense_date ? 1 : -1)));
    setImportRows(null);
    setPanel("none");
    const newest = picked.map((r) => r.date).sort().reverse()[0];
    if (newest) setMonth(newest.slice(0, 7));
    flash(`Added ${added.length} expense${added.length === 1 ? "" : "s"}.`);
  }

  // ---- Edit ----
  async function updateExpense(id: string, patch: Partial<Expense>) {
    const before = expenses.find((e) => e.id === id);
    setExpenses((current) => current.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    const { error } = await supabase.from("expenses").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error && before) {
      setExpenses((current) => current.map((e) => (e.id === id ? before : e)));
      flash(`Couldn't save: ${error.message}`);
    }
  }

  async function changeCategory(expense: Expense, category: string) {
    await updateExpense(expense.id, { category });
    // Offer a rule unless one of the shop's rules already sends this line to that category.
    const ruleCategory = categorize(expense.description, rules.filter(Boolean));
    if (ruleCategory !== category && category !== "Uncategorized") setRememberFor({ id: expense.id, keyword: suggestKeyword(expense.description) });
    else setRememberFor(null);
  }

  async function saveRule(matchText: string, category: string, applyToUncategorized = true) {
    const text = matchText.trim().toUpperCase();
    if (!text) return;
    const existing = rules.find((r) => r.match_text.toUpperCase() === text);
    const result = existing
      ? await supabase.from("expense_rules").update({ category }).eq("id", existing.id).select("*").single()
      : await supabase.from("expense_rules").insert({ owner_id: ownerId, match_text: text, category }).select("*").single();
    if (result.error) { flash(`Couldn't save rule: ${result.error.message}`); return; }
    const rule = result.data as Rule;
    setRules((current) => [...current.filter((r) => r.id !== rule.id), rule].sort((a, b) => a.match_text.localeCompare(b.match_text)));
    setRememberFor(null);
    if (applyToUncategorized) {
      const targets = expenses.filter((e) => e.category === "Uncategorized" && e.description.toUpperCase().includes(text));
      if (targets.length) {
        const ids = targets.map((e) => e.id);
        const { error } = await supabase.from("expenses").update({ category, updated_at: new Date().toISOString() }).in("id", ids);
        if (!error) setExpenses((current) => current.map((e) => (ids.includes(e.id) ? { ...e, category } : e)));
        flash(`Rule saved. ${targets.length} other uncategorized line${targets.length === 1 ? "" : "s"} moved to ${category}.`);
        return;
      }
    }
    flash("Rule saved. Future imports will use it.");
  }

  async function deleteRule(id: string) {
    const { error } = await supabase.from("expense_rules").delete().eq("id", id);
    if (error) { flash(`Couldn't delete rule: ${error.message}`); return; }
    setRules((current) => current.filter((r) => r.id !== id));
  }

  async function deleteExpense(expense: Expense) {
    if (!window.confirm(`Delete "${expense.description}" (${money(expense.amount)})?`)) return;
    const { error } = await supabase.from("expenses").delete().eq("id", expense.id);
    if (error) { flash(`Couldn't delete: ${error.message}`); return; }
    setExpenses((current) => current.filter((e) => e.id !== expense.id));
  }

  // ---- Manual add ----
  const blankForm = { date: todayKey(), description: "", amount: "", category: "Parts & Materials", payment_method: "Card", repair_order_id: "" };
  const [form, setForm] = useState(blankForm);
  async function addManual(event: FormEvent) {
    event.preventDefault();
    const amount = toNumber(form.amount);
    if (!form.description.trim() || amount === null || !form.date) return;
    setBusy(true);
    const { data, error } = await supabase.from("expenses").insert({
      owner_id: ownerId,
      expense_date: form.date,
      description: form.description.trim(),
      amount,
      category: form.category,
      payment_method: form.payment_method,
      repair_order_id: form.repair_order_id || null,
      source: "manual",
    }).select("*").single();
    setBusy(false);
    if (error) { flash(`Couldn't save: ${error.message}`); return; }
    const added = { ...(data as Expense), amount: Number((data as Expense).amount) };
    setExpenses((current) => [added, ...current].sort((a, b) => (a.expense_date < b.expense_date ? 1 : -1)));
    setForm({ ...blankForm, date: form.date, category: form.category, payment_method: form.payment_method });
    setMonth(form.date.slice(0, 7));
    flash("Expense added.");
  }

  function downloadCsv() {
    const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [["Date", "Description", "Category", "Payment method", "RO", "Amount"].map(cell).join(",")];
    for (const e of [...monthExpenses].reverse()) {
      lines.push([e.expense_date, e.description, e.category, e.payment_method, e.repair_order_id ? roLabel.get(e.repair_order_id) ?? "" : "", e.amount.toFixed(2)].map(cell).join(","));
    }
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="empty-state">Loading expenses…</div>;
  if (loadError) return <div className="empty-state">Expenses aren&apos;t set up on this account yet ({loadError}).</div>;

  const importPicked = importRows?.filter((r) => r.include && !r.duplicate) ?? [];

  return (
    <div className="expenses">
      <p className="muted" style={{ marginBottom: 16 }}>
        Import your card statement once a month and everything sorts itself by your rules. Net profit is paid sales (before tax) minus
        card processing fees and every expense in the month, including parts you bought.
      </p>

      <div className="expenses-toolbar">
        <label className="expenses-month">
          <span className="muted">Month</span>
          <select aria-label="Month" value={month} onChange={(event) => setMonth(event.target.value)}>
            {months.map((key) => <option key={key} value={key}>{monthLabel(key)}</option>)}
          </select>
        </label>
        <div className="expenses-actions">
          <button type="button" className={`button small ${panel === "import" ? "secondary" : "primary"}`} onClick={() => { setPanel(panel === "import" ? "none" : "import"); setImportRows(null); setImportMessage(""); }}>
            Import card statement
          </button>
          <button type="button" className="button small secondary" onClick={() => setPanel(panel === "add" ? "none" : "add")}>Add expense</button>
          <button type="button" className="button small secondary" onClick={downloadCsv} disabled={!monthExpenses.length}>Download CSV</button>
        </div>
      </div>

      {notice && <div className="notice expenses-notice" role="status">{notice}</div>}

      {panel === "import" && (
        <section className="panel expenses-panel">
          <h3>Import card statement</h3>
          <ol className="muted expenses-steps">
            <li>In Wells Fargo online, open the card, then <strong>Download Account Activity</strong>.</li>
            <li>Pick the dates and choose <strong>Comma Delimited</strong> (CSV).</li>
            <li>Upload that file here. Other banks&apos; CSV files work too.</li>
          </ol>
          <label className="button small primary expenses-file">
            Choose CSV file
            <input type="file" accept=".csv,text/csv" onChange={(event) => void onFile(event)} hidden />
          </label>
          {importMessage && <p className="expenses-error">{importMessage}</p>}
          {importRows && (
            <>
              <p className="muted" style={{ margin: "12px 0" }}>
                {importRows.length} transactions found. Card payments, refunds and lines you already imported are unchecked. Fix any
                categories, then add them.
              </p>
              <div className="table-wrap">
                <table className="report-table expenses-table">
                  <thead><tr><th></th><th>Date</th><th>Description</th><th>Category</th><th className="num">Amount</th></tr></thead>
                  <tbody>
                    {importRows.map((row, index) => (
                      <tr key={row.key} className={row.include && !row.duplicate ? "" : "is-skipped"}>
                        <td>
                          <input type="checkbox" aria-label={`Include ${row.description}`} disabled={row.duplicate} checked={row.include && !row.duplicate}
                            onChange={(event) => setImportRows((rows) => rows && rows.map((r, i) => (i === index ? { ...r, include: event.target.checked } : r)))} />
                        </td>
                        <td>{shortDate(row.date)}</td>
                        <td>{row.description}{row.duplicate && <span className="expenses-tag">Already imported</span>}{!row.duplicate && row.amount <= 0 && <span className="expenses-tag">Payment / refund</span>}</td>
                        <td>
                          <select aria-label="Category" value={row.category} disabled={row.duplicate}
                            onChange={(event) => setImportRows((rows) => rows && rows.map((r, i) => (i === index ? { ...r, category: event.target.value } : r)))}>
                            {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                          </select>
                        </td>
                        <td className="num">{money(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="expenses-import-foot">
                <strong>{importPicked.length} selected · {money(importPicked.reduce((s, r) => s + r.amount, 0))}</strong>
                <button type="button" className="button primary" disabled={busy || !importPicked.length} onClick={() => void saveImport()}>
                  {busy ? "Adding…" : `Add ${importPicked.length} expense${importPicked.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {panel === "add" && (
        <form className="panel expenses-panel expenses-add" onSubmit={(event) => void addManual(event)}>
          <h3>Add expense</h3>
          <div className="expenses-add-grid">
            <label>Date<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></label>
            <label className="wide">Description<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Rent, O'Reilly, Home Depot…" required /></label>
            <label>Amount<input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" required /></label>
            <label>Category<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label>Paid with<select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}><option>Card</option><option>Cash</option><option>Check</option><option>Bank transfer</option></select></label>
            <label>For RO (optional)<select value={form.repair_order_id} onChange={(e) => setForm({ ...form, repair_order_id: e.target.value })}><option value="">—</option>{roOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
          </div>
          <button type="submit" className="button primary" disabled={busy}>{busy ? "Saving…" : "Add expense"}</button>
        </form>
      )}

      <div className="stat-tiles expenses-tiles">
        <div className="panel"><div className="muted">Paid sales (before tax)</div><div className="expenses-big">{money(sales?.sales ?? 0)}</div></div>
        <div className="panel"><div className="muted">Expenses</div><div className="expenses-big">{money(totalExpenses)}</div></div>
        <div className="panel">
          <div className="muted">Net profit{sales?.fees ? ` (after ${money(sales.fees)} card fees)` : ""}</div>
          <div className={`expenses-big ${netProfit >= 0 ? "is-positive" : "is-negative"}`}>{money(netProfit)}</div>
        </div>
      </div>

      {uncategorized > 0 && (
        <button type="button" className="expenses-uncat" onClick={() => setFilter("Uncategorized")}>
          {uncategorized} expense{uncategorized === 1 ? "" : "s"} in {monthLabel(month)} still need a category. Show them
        </button>
      )}

      {byCategory.length > 0 && (
        <div className="expenses-cats">
          <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All <strong>{money(totalExpenses)}</strong></button>
          {byCategory.map(([category, total]) => (
            <button type="button" key={category} className={filter === category ? "active" : ""} onClick={() => setFilter(filter === category ? "all" : category)}>
              {category} <strong>{money(total)}</strong>
            </button>
          ))}
        </div>
      )}

      {!monthExpenses.length ? (
        <div className="empty-state">No expenses in {monthLabel(month)} yet. Import your card statement or add one by hand.</div>
      ) : (
        <div className="table-wrap">
          <table className="report-table expenses-table">
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>RO</th><th className="num">Amount</th><th></th></tr></thead>
            <tbody>
              {shown.map((expense) => (
                <tr key={expense.id}>
                  <td>{shortDate(expense.expense_date)}</td>
                  <td>
                    {expense.description}
                    {expense.payment_method !== "Card" && <span className="expenses-tag">{expense.payment_method}</span>}
                    {rememberFor?.id === expense.id && (
                      <div className="expenses-remember">
                        <span>Always put lines containing</span>
                        <input aria-label="Text to match" value={rememberFor.keyword} onChange={(e) => setRememberFor({ id: expense.id, keyword: e.target.value })} />
                        <span>in {expense.category}?</span>
                        <button type="button" className="button small primary" onClick={() => void saveRule(rememberFor.keyword, expense.category)}>Yes</button>
                        <button type="button" className="button small ghost" onClick={() => setRememberFor(null)}>No</button>
                      </div>
                    )}
                  </td>
                  <td>
                    <select aria-label="Category" className={expense.category === "Uncategorized" ? "is-uncat" : ""} value={expense.category} onChange={(e) => void changeCategory(expense, e.target.value)}>
                      {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                      {!EXPENSE_CATEGORIES.includes(expense.category as (typeof EXPENSE_CATEGORIES)[number]) && <option>{expense.category}</option>}
                    </select>
                  </td>
                  <td>
                    <select aria-label="Repair order" value={expense.repair_order_id ?? ""} onChange={(e) => void updateExpense(expense.id, { repair_order_id: e.target.value || null })}>
                      <option value="">—</option>
                      {roOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </td>
                  <td className="num">{money(expense.amount)}</td>
                  <td><button type="button" className="button small ghost" aria-label={`Delete ${expense.description}`} onClick={() => void deleteExpense(expense)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="expenses-rules">
        <summary>Category rules ({rules.length})</summary>
        <p className="muted">When a statement line contains the text, it goes in that category. Your rules beat the built-in ones (O&apos;Reilly, AutoZone, NAPA → Parts &amp; Materials, and so on).</p>
        <RuleForm onSave={(text, category) => void saveRule(text, category)} />
        {rules.length > 0 && (
          <ul>
            {rules.map((rule) => (
              <li key={rule.id}><code>{rule.match_text}</code> → {rule.category} <button type="button" className="button small ghost" onClick={() => void deleteRule(rule.id)}>Remove</button></li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

function RuleForm({ onSave }: { onSave: (text: string, category: string) => void }) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState<string>("Parts & Materials");
  return (
    <form className="expenses-rule-form" onSubmit={(event) => { event.preventDefault(); if (!text.trim()) return; onSave(text, category); setText(""); }}>
      <input aria-label="Text to match" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. ELLIOTT" />
      <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
      <button type="submit" className="button small secondary">Add rule</button>
    </form>
  );
}
