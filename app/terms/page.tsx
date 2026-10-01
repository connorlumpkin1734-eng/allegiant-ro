// Public, no-login Terms of Service. Linked from the signup screen and the in-app footer.
//
// ⚠️ ENTITY PLACEHOLDER: the LLC that will operate this service hasn't been formed yet, so this
// document currently names "Allegiant Auto Care" as the operator. The instant the LLC exists,
// every "CHANGE ME" marker below must be swapped for the real legal entity name, state of
// formation, and registered contact address — do a find for "CHANGE ME" in this file.
const LAST_UPDATED = "September 30, 2026";

export default function TermsPage() {
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
          real legal entity name, state of formation, and registered address before relying on this
          for shops other than your own.
        </div>

        <h1 style={{ margin: "0 0 4px" }}>Terms of Service</h1>
        <p style={{ color: "#8493a6", fontSize: 13, marginTop: 0 }}>Last updated: {LAST_UPDATED}</p>

        <p>
          These Terms of Service (&quot;Terms&quot;) govern access to and use of the repair order
          management software (the &quot;Service&quot;) provided by Allegiant Auto Care{" "}
          <strong>(CHANGE ME: legal entity name, e.g. &quot;[Your LLC Name], a Texas limited
          liability company&quot;)</strong>, with a registered address at{" "}
          <strong>CHANGE ME: registered address</strong> (&quot;we,&quot; &quot;us,&quot; or
          &quot;our&quot;). By creating an account or using the Service, you agree to these Terms on
          behalf of yourself and the business you represent (&quot;you&quot; or &quot;your
          shop&quot;).
        </p>

        <h2>1. The Service</h2>
        <p>
          The Service is software that helps auto repair shops create and manage repair orders,
          estimates, invoices, staff accounts, and customer payments. We may add, change, or remove
          features over time.
        </p>

        <h2>2. Accounts and staff access</h2>
        <p>
          You&apos;re responsible for the accuracy of the information you provide, for keeping your
          login credentials confidential, and for all activity under your shop&apos;s account,
          including activity by staff accounts you create. You&apos;re responsible for deactivating
          staff accounts when someone leaves your shop.
        </p>

        <h2>3. Free trial</h2>
        <p>
          New accounts may start on a free trial limited to a set number of repair orders, as shown
          in the product. We may change the trial limit or terms at any time. Attempting to
          circumvent trial limits (for example, by creating duplicate accounts) may result in
          suspension.
        </p>

        <h2>4. Subscription, billing, and cancellation</h2>
        <p>
          Paid plans are billed on a recurring basis at the price shown at checkout. You can cancel
          your subscription at any time; cancellation takes effect at the end of your current billing
          period, and you&apos;ll keep access until then.
        </p>
        <p>
          <strong>No refunds.</strong> Payments already made are non-refundable, including for
          partial billing periods, except where required by law.
        </p>

        <h2>5. Payments to your shop from your customers</h2>
        <p>
          If you connect a payment processor (currently Stripe) to accept payments from your own
          customers, that processing relationship and those funds are between you, your customer, and
          the payment processor. We are not a party to those transactions, do not hold your funds, and
          are not responsible for payment processor outages, holds, or disputes — those are governed
          by the payment processor&apos;s own terms.
        </p>

        <h2>6. Your data</h2>
        <p>
          You retain ownership of the repair order, customer, and business data you put into the
          Service. You&apos;re responsible for having the right to store your customers&apos; contact
          and vehicle information in the Service and for complying with laws that apply to your own
          business. See our <a href="/privacy">Privacy Policy</a> for how we handle data.
        </p>

        <h2>7. Acceptable use</h2>
        <p>
          You agree not to misuse the Service — including attempting to access another shop&apos;s
          data, interfering with the Service&apos;s operation, or using it for any unlawful purpose.
        </p>

        <h2>8. Disclaimer of warranties</h2>
        <p>
          The Service is provided &quot;as is&quot; and &quot;as available,&quot; without warranties
          of any kind, whether express or implied, including warranties of merchantability, fitness
          for a particular purpose, and non-infringement. We don&apos;t guarantee the Service will be
          uninterrupted, error-free, or completely secure.
        </p>

        <h2>9. Limitation of liability</h2>
        <p>
          To the fullest extent permitted by law, our total liability to you for any claim arising out
          of or relating to the Service will not exceed the total fees you paid us in the six (6)
          months immediately before the event giving rise to the claim. In no event will we be liable
          for indirect, incidental, special, consequential, or punitive damages, including lost
          profits or lost data, even if we were advised of the possibility of such damages.
        </p>

        <h2>10. Termination</h2>
        <p>
          We may suspend or terminate your access to the Service if you violate these Terms, misuse
          the Service, or for non-payment. You may stop using the Service and cancel your account at
          any time.
        </p>

        <h2>11. Changes to these Terms</h2>
        <p>
          We may update these Terms from time to time. If we make material changes, we&apos;ll make
          reasonable efforts to notify you (such as by email or an in-app notice). Continued use of
          the Service after changes take effect means you accept the updated Terms.
        </p>

        <h2>12. Governing law</h2>
        <p>
          These Terms are governed by the laws of the State of Texas, without regard to its conflict
          of law principles.{" "}
          <strong>CHANGE ME: confirm this is still correct once the LLC&apos;s state of formation is
          final.</strong>
        </p>

        <h2>13. Contact</h2>
        <p>Questions about these Terms can be sent to connor.lumpkin1734@gmail.com.</p>
      </article>
    </main>
  );
}
