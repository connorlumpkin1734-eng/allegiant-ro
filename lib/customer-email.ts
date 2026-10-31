// Shared look for every email a customer gets from a shop (estimate, invoice, inspection).
// Email apps ignore most modern CSS, so this is table-based with inline styles: it renders the same
// in Gmail, Apple Mail and Outlook, on phones and desktops.

export type ShopBrand = {
  name: string;
  logoUrl: string | null;
  phone: string;
  email: string;
  address: string;
  hours: string;
  primaryColor: string;
  accentColor: string;
};

export const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

export const money = (amount: number) => Number(amount || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

const HEX = /^#[0-9a-f]{6}$/i;
const safeColor = (value: unknown, fallback: string) => (typeof value === "string" && HEX.test(value.trim()) ? value.trim() : fallback);

/** White or near-black text, whichever reads better on this background. */
export function textOn(background: string): string {
  const hex = safeColor(background, "#000000").slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? "#111827" : "#ffffff";
}

export function brandFromSettings(settings: Record<string, unknown>, supabaseUrl: string): ShopBrand {
  const logoPath = settings.logo_path as string | null | undefined;
  return {
    name: ((settings.business_name as string) || "").trim() || "Your repair shop",
    logoUrl: logoPath ? `${supabaseUrl}/storage/v1/object/public/shop-branding/${logoPath}` : null,
    phone: ((settings.business_phone as string) || "").trim(),
    email: ((settings.business_email as string) || "").trim(),
    address: ((settings.business_address as string) || "").trim(),
    hours: ((settings.business_hours as string) || "").trim(),
    primaryColor: safeColor(settings.primary_color, "#2459a9"),
    accentColor: safeColor(settings.accent_color, "#b5222d"),
  };
}

const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** A tappable button that works in every email app (including Outlook). */
export function emailButton(label: string, url: string, color: string, variant: "solid" | "outline" = "solid"): string {
  const solid = variant === "solid";
  const fg = solid ? textOn(color) : color;
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto"><tr>
    <td align="center" bgcolor="${solid ? color : "#ffffff"}" style="border-radius:8px;${solid ? "" : `border:2px solid ${color};`}">
      <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:${solid ? "15px 30px" : "13px 28px"};font-family:${FONT};font-size:16px;font-weight:700;color:${fg};text-decoration:none;border-radius:8px">${escapeHtml(label)}</a>
    </td></tr></table>`;
}

/** A big centered amount, e.g. "Estimated total $289.35". */
export function amountBlock(label: string, amount: string, color: string, note = ""): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 22px"><tr>
    <td align="center" style="padding:20px 16px;border:1px solid ${LINE};border-radius:12px;background:#f9fafb">
      <div style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${color}">${escapeHtml(label)}</div>
      <div style="font-family:${FONT};font-size:34px;font-weight:800;color:${INK};margin-top:4px">${escapeHtml(amount)}</div>
      ${note ? `<div style="font-family:${FONT};font-size:13px;color:${MUTED};margin-top:4px">${escapeHtml(note)}</div>` : ""}
    </td></tr></table>`;
}

/** Rows of "name ........ price", with optional small grey detail and a heading per group. */
export type LineRow = { label: string; amount?: string; detail?: string; tag?: string; strong?: boolean };
export function lineTable(groups: Array<{ heading?: string; subheading?: string; rows: LineRow[] }>, accent: string): string {
  const parts = groups.map((group) => {
    const head = group.heading
      ? `<tr><td colspan="2" style="padding:16px 0 4px;font-family:${FONT};font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:${accent}">${escapeHtml(group.heading)}</td></tr>`
        + (group.subheading ? `<tr><td colspan="2" style="padding:0 0 6px;font-family:${FONT};font-size:14px;color:${MUTED};font-style:italic">“${escapeHtml(group.subheading)}”</td></tr>` : "")
      : "";
    const rows = group.rows.map((row) => `<tr>
      <td style="padding:9px 12px 9px 0;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:15px;color:${INK};${row.strong ? "font-weight:700;" : ""}vertical-align:top">
        ${escapeHtml(row.label)}${row.tag ? ` <span style="display:inline-block;margin-left:4px;padding:1px 7px;border-radius:999px;background:#f3f4f6;color:${MUTED};font-size:11px;font-weight:700;vertical-align:1px">${escapeHtml(row.tag)}</span>` : ""}
        ${row.detail ? `<div style="font-size:13px;color:${MUTED};margin-top:2px;font-weight:400">${escapeHtml(row.detail)}</div>` : ""}
      </td>
      <td align="right" style="padding:9px 0;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:15px;color:${INK};white-space:nowrap;vertical-align:top;${row.strong ? "font-weight:700;" : ""}">${escapeHtml(row.amount ?? "")}</td>
    </tr>`).join("");
    return head + rows;
  }).join("");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px">${parts}</table>`;
}

/** Subtotal / tax / total, right-aligned under a line table. */
export function totalsTable(rows: Array<{ label: string; amount: string; strong?: boolean }>): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:-8px 0 22px">${rows.map((row) => `<tr>
    <td align="right" style="padding:4px 12px 4px 0;font-family:${FONT};font-size:${row.strong ? 16 : 14}px;color:${row.strong ? INK : MUTED};${row.strong ? "font-weight:800;" : ""}">${escapeHtml(row.label)}</td>
    <td align="right" width="110" style="padding:4px 0;font-family:${FONT};font-size:${row.strong ? 16 : 14}px;color:${INK};white-space:nowrap;${row.strong ? "font-weight:800;" : ""}">${escapeHtml(row.amount)}</td>
  </tr>`).join("")}</table>`;
}

export function paragraph(text: string, muted = false): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:${muted ? 14 : 16}px;line-height:1.55;color:${muted ? MUTED : INK}">${text}</p>`;
}

export function renderCustomerEmail({
  brand,
  preheader,
  documentLabel,
  vehicle,
  greeting,
  intro,
  body,
  primaryButton,
  secondaryButton,
  fallbackUrl,
  finePrint,
}: {
  brand: ShopBrand;
  /** The grey preview line inbox apps show next to the subject. */
  preheader: string;
  /** e.g. "Estimate #0021" */
  documentLabel: string;
  vehicle: string;
  greeting: string;
  /** Already-escaped HTML. */
  intro: string;
  /** Already-escaped HTML that goes above the main button. */
  body?: string;
  primaryButton?: { label: string; url: string };
  secondaryButton?: { label: string; url: string };
  /** Small "button not working?" link at the bottom. */
  fallbackUrl?: string;
  /** Already-escaped HTML, small grey text under the buttons. */
  finePrint?: string;
}): string {
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.name)}" style="display:block;max-height:52px;max-width:220px;height:auto;border:0" />`
    : `<div style="font-family:${FONT};font-size:22px;font-weight:800;color:${INK}">${escapeHtml(brand.name)}</div>`;
  const phoneLink = brand.phone ? `<a href="tel:${escapeHtml(brand.phone.replace(/[^\d+]/g, ""))}" style="color:${brand.primaryColor};text-decoration:none;font-weight:700">${escapeHtml(brand.phone)}</a>` : "";
  const footerLines = [
    `<strong style="color:${INK}">${escapeHtml(brand.name)}</strong>`,
    brand.address ? escapeHtml(brand.address).replaceAll("\n", "<br>") : "",
    [phoneLink, brand.email ? `<a href="mailto:${escapeHtml(brand.email)}" style="color:${brand.primaryColor};text-decoration:none">${escapeHtml(brand.email)}</a>` : ""].filter(Boolean).join(" &nbsp;·&nbsp; "),
    brand.hours ? `Hours: ${escapeHtml(brand.hours)}` : "",
  ].filter(Boolean).join("<br>");
  const questions = brand.phone
    ? `Questions? Call us at ${phoneLink}${brand.email ? " or just reply to this email." : "."}`
    : "Questions? Just reply to this email.";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${escapeHtml(documentLabel)} from ${escapeHtml(brand.name)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f3f4f6" style="background:#f3f4f6"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${LINE}">
    <tr><td height="6" bgcolor="${brand.primaryColor}" style="background:${brand.primaryColor};font-size:0;line-height:0">&nbsp;</td></tr>
    <tr><td style="padding:26px 28px 18px;border-bottom:1px solid ${LINE}">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
        <td valign="middle">${logo}</td>
        <td valign="middle" align="right" style="font-family:${FONT};font-size:13px;color:${MUTED};line-height:1.4">
          <div style="font-weight:800;color:${INK};font-size:14px">${escapeHtml(documentLabel)}</div>
          ${vehicle ? `<div>${escapeHtml(vehicle)}</div>` : ""}
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:28px 28px 8px">
      <p style="margin:0 0 12px;font-family:${FONT};font-size:20px;font-weight:700;color:${INK}">${escapeHtml(greeting)}</p>
      ${paragraph(intro)}
      ${body ?? ""}
      ${primaryButton ? `<div style="margin:6px 0 14px">${emailButton(primaryButton.label, primaryButton.url, brand.accentColor)}</div>` : ""}
      ${secondaryButton ? `<div style="margin:0 0 14px">${emailButton(secondaryButton.label, secondaryButton.url, brand.primaryColor, "outline")}</div>` : ""}
      ${finePrint ? `<div style="text-align:center">${paragraph(finePrint, true)}</div>` : ""}
      <div style="text-align:center">${paragraph(questions, true)}</div>
    </td></tr>
    <tr><td style="padding:20px 28px 24px;background:#f9fafb;border-top:1px solid ${LINE};font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED}">
      ${footerLines}
      ${fallbackUrl ? `<div style="margin-top:14px;font-size:11px;line-height:1.5;color:#9ca3af">Button not working? Copy this link into your browser:<br><a href="${escapeHtml(fallbackUrl)}" style="color:#9ca3af;word-break:break-all">${escapeHtml(fallbackUrl)}</a></div>` : ""}
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

/** Plain-text version for email apps that don't show HTML. */
export function renderCustomerText(lines: Array<string | false | null | undefined>, brand: ShopBrand): string {
  const footer = [brand.name, brand.address, brand.phone, brand.email, brand.hours ? `Hours: ${brand.hours}` : ""].filter(Boolean).join("\n");
  return `${lines.filter((line) => line !== false && line != null).join("\n")}\n\n${footer}`;
}
