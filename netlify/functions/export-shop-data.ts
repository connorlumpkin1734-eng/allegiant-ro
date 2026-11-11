import { notifyError } from "../../lib/platform-alert";
// Owner-only: everything the shop has in ROrunner, as one .zip the owner can keep or take elsewhere.
// Spreadsheet-friendly CSVs for the everyday records, plus a complete JSON copy of every table.
// Works whatever the subscription status is (including canceled): your data is yours to take.
//
// Left out on purpose: secret links and tokens (payment/share links, Square tokens), and in-app
// notifications. Photos and videos are listed by file path, not bundled (they can be large).

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

type Row = Record<string, unknown>;

// Table -> columns to leave out of the export.
const TABLES: Record<string, string[]> = {
  settings: ["is_platform_admin"],
  customers: [],
  vehicles: [],
  repair_orders: [],
  concern_lines: [],
  line_items: [],
  multipoint_inspections: ["share_token_hash", "share_token"],
  estimate_authorizations: ["token_hash"],
  estimate_photos: [],
  estimate_videos: [],
  payments: ["token_hash"],
  teams: [],
  staff: ["auth_user_id"],
  repair_order_technicians: [],
};

async function fetchAll(supabaseUrl: string, headers: Record<string, string>, table: string, ownerId: string): Promise<Row[]> {
  const rows: Row[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const orderBy = table === "settings" ? "owner_id" : "id";
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=*&owner_id=eq.${ownerId}&order=${orderBy}.asc`, {
      headers: { ...headers, Range: `${offset}-${offset + pageSize - 1}` },
    });
    if (!response.ok) throw new Error(`Exporting ${table} failed (HTTP ${response.status}).`);
    const page = await response.json() as Row[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  const omit = TABLES[table] || [];
  return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !omit.includes(key))));
}

function csv(rows: Row[], columns: string[]): string {
  const cell = (value: unknown) => {
    if (value === null || value === undefined) return "";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [columns.join(","), ...rows.map((row) => columns.map((column) => cell(row[column])).join(","))].join("\r\n");
}

// --- Minimal .zip writer (stored, no compression): enough for text files, no dependencies. ---
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files: Array<{ name: string; content: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, dosTime, true);
    entry.setUint16(14, dosDate, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of all) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !publicKey || !serviceKey) return json({ error: "Export isn't configured." }, 500);

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: request.headers.get("authorization") || "" },
  });
  if (!userResponse.ok) return json({ error: "Sign in again." }, 401);
  const user = await userResponse.json() as { id: string };

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const settingsRows = await fetchAll(supabaseUrl, headers, "settings", user.id);
  if (!settingsRows.length) return json({ error: "Only the shop owner can export the shop's data." }, 403);

  const data: Record<string, Row[]> = { settings: settingsRows };
  for (const table of Object.keys(TABLES)) {
    if (table !== "settings") data[table] = await fetchAll(supabaseUrl, headers, table, user.id);
  }

  const customersById = new Map(data.customers.map((row) => [row.id, row]));
  const vehiclesById = new Map(data.vehicles.map((row) => [row.id, row]));
  const roTotals = new Map<unknown, number>();
  for (const item of data.line_items) {
    const total = Number(item.quantity || 0) * Number(item.unit_price || 0);
    roTotals.set(item.repair_order_id, (roTotals.get(item.repair_order_id) || 0) + total);
  }
  const repairOrders = data.repair_orders.map((ro) => {
    const customer = customersById.get(ro.customer_id);
    const vehicle = vehiclesById.get(ro.vehicle_id);
    return {
      ...ro,
      customer_name: customer?.name ?? "",
      vehicle: vehicle ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") : "",
      vin: vehicle?.vin ?? "",
      line_items_subtotal: (roTotals.get(ro.id) || 0).toFixed(2),
    };
  });

  const shopName = String(settingsRows[0].business_name || "shop");
  const date = new Date().toISOString().slice(0, 10);
  const readme = [
    `ROrunner export for ${shopName}, created ${new Date().toUTCString()}.`,
    "",
    "customers.csv, vehicles.csv, repair_orders.csv, line_items.csv and payments.csv open in Excel,",
    "Google Sheets or Numbers. ro_number on repair_orders.csv is the number shown on your ROs.",
    "",
    "all-data.json is a complete copy of every record, for moving to other software.",
    "Photo and video entries list where each file was stored; the files themselves aren't included.",
  ].join("\r\n");

  const files = [
    { name: "README.txt", content: readme },
    { name: "customers.csv", content: csv(data.customers, ["id", "name", "phone", "email", "address_line_1", "address_line_2", "city", "state", "zip_code", "notes", "created_at", "archived_at"]) },
    { name: "vehicles.csv", content: csv(data.vehicles, ["id", "customer_id", "year", "make", "model", "trim", "engine", "vin", "license_plate", "plate_state", "color", "notes", "created_at"]) },
    { name: "repair_orders.csv", content: csv(repairOrders, ["ro_number", "status", "customer_name", "vehicle", "vin", "mileage_in", "mileage_out", "customer_concern", "notes", "line_items_subtotal", "tax_rate", "paid", "paid_at", "created_at", "completed_at", "id", "customer_id", "vehicle_id"]) },
    { name: "line_items.csv", content: csv(data.line_items, ["repair_order_id", "service_group_title", "item_type", "description", "quantity", "unit_cost", "markup_percent", "unit_price", "taxable", "job_status", "service_concern", "work_performed", "technician_story", "internal_notes", "created_at"]) },
    { name: "payments.csv", content: csv(data.payments, ["repair_order_id", "processor", "payment_method_type", "amount", "fee_amount", "net_amount", "status", "created_at", "confirmation_note"]) },
    { name: "all-data.json", content: JSON.stringify({ exported_at: new Date().toISOString(), shop: shopName, tables: data }, null, 2) },
  ];

  const safeName = shopName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "shop";
  return new Response(zip(files), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="rorunner-${safeName}-${date}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}

export default async (request: Request) => {
  try {
    return await handler(request);
  } catch (error) {
    await notifyError("export-shop-data", error, request);
    return json({ error: "The export failed. Please try again." }, 500);
  }
};
