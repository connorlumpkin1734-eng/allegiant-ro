// Where outgoing email comes from. Each shop's customer emails go out as
// "<Shop Name> <estimates@SENDER_DOMAIN>" with reply-to set to the shop's own email.
//
// Set EMAIL_SENDER_DOMAIN in Netlify once the domain is verified in Resend (e.g. rorunner.com).
// Unset, it falls back to allegiantautocare.com so nothing breaks before then.
export function senderDomain(): string {
  return (process.env.EMAIL_SENDER_DOMAIN || "allegiantautocare.com").trim().replace(/^@/, "");
}

/** "Name <local@domain>" with the name's quotes/angle brackets stripped so it can't break the header. */
export function fromAddress(name: string, localPart: string): string {
  const safeName = (name || "").replace(/["<>\r\n]/g, "").trim() || "Repair shop";
  return `${safeName} <${localPart}@${senderDomain()}>`;
}

/** Internal alerts to the platform owner (errors, backups). */
export function alertsFrom(): string {
  return fromAddress(`${process.env.EMAIL_PRODUCT_NAME || "RO Runner"} Alerts`, "alerts");
}
