const json = (body: unknown, status = 200, origin = "*") => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  },
});

const allowedOrigins = new Set([
  "https://allegiantautocare.com",
  "https://www.allegiantautocare.com",
  "http://localhost:3000",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const maxFileBytes = 12 * 1024 * 1024;
const maxFiles = 8;

function cleanText(value: FormDataEntryValue | null, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanPhone(value: string): string {
  return value.replace(/[^0-9+().\-\s]/g, "").trim().slice(0, 40);
}

function cleanVin(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 17);
}

function storagePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function safeFileName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100) || "upload";
}

async function rest<T>(url: string, key: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.status === 204 ? (undefined as T) : await response.json() as T;
}

export default async (request: Request) => {
  const requestOrigin = request.headers.get("origin") || "";
  const origin = allowedOrigins.has(requestOrigin) ? requestOrigin : requestOrigin ? "" : "*";

  if (request.method === "OPTIONS") {
    if (requestOrigin && !allowedOrigins.has(requestOrigin)) return json({ error: "Origin not allowed." }, 403, "null");
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin || "null",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
      },
    });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, origin || "null");
  if (requestOrigin && !allowedOrigins.has(requestOrigin)) return json({ error: "Origin not allowed." }, 403, "null");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json({ error: "Quote intake is not configured." }, 500, origin || "null");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Could not read the quote request." }, 400, origin || "null");
  }

  // Honeypot for low-effort bots.
  if (cleanText(form.get("company_website"), 200)) return json({ ok: true }, 200, origin || "null");

  const name = cleanText(form.get("name"), 120);
  const phone = cleanPhone(cleanText(form.get("phone"), 60));
  const email = cleanText(form.get("email"), 160).toLowerCase();
  const preferredContact = cleanText(form.get("preferred_contact"), 20) || null;
  const requestType = cleanText(form.get("request_type"), 30) === "second_opinion" ? "second_opinion" : "quote";
  const vehicleYearRaw = cleanText(form.get("vehicle_year"), 4);
  const vehicleYear = /^\d{4}$/.test(vehicleYearRaw) ? Number(vehicleYearRaw) : null;
  const vehicleMake = cleanText(form.get("vehicle_make"), 80) || null;
  const vehicleModel = cleanText(form.get("vehicle_model"), 80) || null;
  const vin = cleanVin(cleanText(form.get("vin"), 40));
  const mileageRaw = cleanText(form.get("mileage"), 12).replace(/[^0-9]/g, "");
  const mileage = mileageRaw ? Number(mileageRaw) : null;
  const requestText = cleanText(form.get("request_text"), 4000) || null;

  if (!name) return json({ error: "Please enter your name." }, 400, origin || "null");
  if (!phone && !email) return json({ error: "Please enter a phone number or email address." }, 400, origin || "null");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Please enter a valid email address." }, 400, origin || "null");
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return json({ error: "Please enter the full 17-character VIN." }, 400, origin || "null");
  if (preferredContact && !["phone", "text", "email"].includes(preferredContact)) return json({ error: "Invalid contact preference." }, 400, origin || "null");

  const fileEntries: Array<{ file: File; kind: "quote" | "vehicle_photo" | "vin_photo" }> = [];
  for (const [field, value] of form.entries()) {
    if (!(value instanceof File) || !value.size) continue;
    const kind = field === "vehicle_photos" ? "vehicle_photo" : field === "vin_photo" ? "vin_photo" : "quote";
    fileEntries.push({ file: value, kind });
  }
  if (fileEntries.length > maxFiles) return json({ error: `Please upload no more than ${maxFiles} files.` }, 400, origin || "null");
  for (const { file } of fileEntries) {
    if (!allowedTypes.has(file.type)) return json({ error: `${file.name} is not a supported file type.` }, 400, origin || "null");
    if (file.size > maxFileBytes) return json({ error: `${file.name} is larger than 12 MB.` }, 400, origin || "null");
  }

  try {
    const owners = await rest<Array<{ owner_id: string }>>(
      `${supabaseUrl}/rest/v1/settings?select=owner_id&limit=1`,
      serviceKey
    );
    const ownerId = owners[0]?.owner_id;
    if (!ownerId) return json({ error: "Shop account could not be resolved." }, 500, origin || "null");

    const inserted = await rest<Array<{ id: string }>>(
      `${supabaseUrl}/rest/v1/quote_requests`,
      serviceKey,
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          owner_id: ownerId,
          source: "website",
          request_type: requestType,
          status: "new",
          name,
          phone: phone || null,
          email: email || null,
          preferred_contact: preferredContact,
          vehicle_year: vehicleYear,
          vehicle_make: vehicleMake,
          vehicle_model: vehicleModel,
          vin,
          mileage: Number.isFinite(mileage) ? mileage : null,
          request_text: requestText,
        }),
      }
    );
    const quoteRequestId = inserted[0]?.id;
    if (!quoteRequestId) throw new Error("Quote request did not return an id.");

    const uploadWarnings: string[] = [];
    for (const { file, kind } of fileEntries) {
      const cleanName = safeFileName(file.name);
      const path = `${ownerId}/${quoteRequestId}/${crypto.randomUUID()}-${cleanName}`;
      const upload = await fetch(`${supabaseUrl}/storage/v1/object/quote-request-files/${storagePath(path)}`, {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": file.type,
          "x-upsert": "false",
        },
        body: await file.arrayBuffer(),
      });
      if (!upload.ok) {
        uploadWarnings.push(`${file.name}: upload failed`);
        continue;
      }

      try {
        await rest(
          `${supabaseUrl}/rest/v1/quote_request_files`,
          serviceKey,
          {
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({
              owner_id: ownerId,
              quote_request_id: quoteRequestId,
              file_kind: kind,
              storage_path: path,
              original_name: file.name.slice(0, 220),
              mime_type: file.type,
              file_size: file.size,
            }),
          }
        );
      } catch {
        uploadWarnings.push(`${file.name}: file saved but could not be attached to the request`);
      }
    }

    return json({
      ok: true,
      quoteRequestId,
      message: "Your request was sent to Allegiant Auto Care.",
      warnings: uploadWarnings,
    }, 201, origin || "null");
  } catch (error) {
    console.error("public quote request failed", error);
    return json({ error: "We could not submit the request right now. Please call 214.236.7698." }, 500, origin || "null");
  }
};
