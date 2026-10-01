// Public, no-login Privacy Policy. Linked from the signup screen and the in-app footer.
//
// ⚠️ ENTITY PLACEHOLDER: same as /terms — this names "Allegiant Auto Care" as the operator until
// the LLC is formed. Find "CHANGE ME" in this file and update it once the entity exists.
const LAST_UPDATED = "September 30, 2026";

export default function PrivacyPage() {
  return (
    <main className="approval-shell">
      <article className="approval-card" style={{ maxWidth: 760 }}>
        <div
          style={{
            background: "#fff3cd",
            border: "2px solid #e0a800",
            borderRadius: 10,
            padding: "14px 18px",
            marginBottom: 24,
            fontWeight: 700,
            color: "#7a5900",
          }}
        >
          ⚠️ CHANGE ME: This document names &quot;Allegiant Auto Care&quot; as the operator because
          the LLC isn&apos;t formed yet. Replace every &quot;CHANGE ME&quot; marker below with the
          real legal entity name and registered address before relying on this for shops other than
          your own.
        </div>

        <h1 style={{ margin: "0 0 4px" }}>Privacy Policy</h1>
        <p style={{ color: "#8493a6", fontSize: 13, marginTop: 0 }}>Last updated: {LAST_UPDATED}</p>

        <p>
          This Privacy Policy explains what information Allegiant Auto Care{" "}
          <strong>(CHANGE ME: legal entity name)</strong>, with a registered address at{" "}
          <strong>CHANGE ME: registered address</strong> (&quot;we,&quot; &quot;us,&quot; or
          &quot;our&quot;), collects through the repair order management software (the
          &quot;Service&quot;), and how we use it.
        </p>

        <h2>1. Information shop owners and staff provide</h2>
        <p>When you sign up or are added as staff, we collect:</p>
        <ul>
          <li>Business information: shop name, business email, and billing details.</li>
          <li>
            Account information: your name, email address (used for sign-in and password resets),
            and a username.
          </li>
        </ul>

        <h2>2. Information you put into the Service</h2>
        <p>
          As part of using the Service, your shop stores information you choose to enter, such as
          customer names, contact information, vehicle details, and repair order/invoice records.
          This information belongs to your shop. We access it only to operate, maintain, and support
          the Service, or when legally required.
        </p>

        <h2>3. Payment information</h2>
        <p>
          We don&apos;t store full credit card numbers or bank account numbers ourselves. Payments
          are processed by Stripe:
        </p>
        <ul>
          <li>
            <strong>Your subscription to this Service</strong> is billed through Stripe, which
            handles your card details directly.
          </li>
          <li>
            <strong>Payments your customers make to your shop</strong> (when you connect your own
            Stripe account) are processed directly between your customer, Stripe, and your shop. We
            receive confirmation that a payment succeeded, but not your customers&apos; full card
            details.
          </li>
        </ul>
        <p>Stripe&apos;s handling of this data is governed by Stripe&apos;s own privacy policy.</p>

        <h2>4. Anonymous site-traffic data</h2>
        <p>
          When someone visits the sign-in/sign-up page, we log a randomly generated identifier (not
          tied to a name, email, or account) along with the visit date, so we can see how many people
          are visiting the site. This is used only in aggregate, internally, to understand overall
          traffic — it is not used to identify individuals or shared with anyone outside our
          organization.
        </p>

        <h2>5. How we use information</h2>
        <ul>
          <li>To provide, maintain, and improve the Service.</li>
          <li>
            To send account-related email (staff login credentials, password resets, invoices and
            estimates you choose to send to your customers, payment receipts).
          </li>
          <li>To provide customer support.</li>
          <li>To detect and prevent misuse, fraud, or abuse of the Service, including trial limits.</li>
          <li>To comply with legal obligations.</li>
        </ul>

        <h2>6. Who we share information with</h2>
        <p>We share information only with the service providers that help us run the Service:</p>
        <ul>
          <li>
            <strong>Supabase</strong> — hosts our database and handles account authentication.
          </li>
          <li>
            <strong>Stripe</strong> — processes subscription billing and, for shops that connect
            their own account, customer payments.
          </li>
          <li>
            <strong>Resend</strong> — delivers transactional email (staff invites, password resets,
            invoices/estimates, receipts) on our behalf.
          </li>
          <li>
            <strong>Netlify</strong> — hosts the application itself.
          </li>
        </ul>
        <p>
          We do not sell personal information, and we do not share your shop&apos;s customer data
          with other shops or with advertisers.
        </p>

        <h2>7. Data retention</h2>
        <p>
          We retain your shop&apos;s data for as long as your account is active, and for a reasonable
          period afterward in case you reactivate or as needed for legitimate business or legal
          purposes. You can request deletion of your account and associated data by contacting us
          (see Section 10).
        </p>

        <h2>8. Security</h2>
        <p>
          We use reasonable technical measures to protect data, including per-shop data isolation at
          the database level and encrypted connections. No method of transmission or storage is 100%
          secure, and we can&apos;t guarantee absolute security.
        </p>

        <h2>9. Children&apos;s privacy</h2>
        <p>The Service is intended for business use and is not directed at children.</p>

        <h2>10. Contact and data requests</h2>
        <p>
          Questions about this policy, or requests to access, correct, or delete your information,
          can be sent to connor.lumpkin1734@gmail.com.
        </p>

        <h2>11. Changes to this policy</h2>
        <p>
          We may update this Privacy Policy from time to time. If we make material changes,
          we&apos;ll make reasonable efforts to notify you (such as by email or an in-app notice).
        </p>
      </article>
    </main>
  );
}
