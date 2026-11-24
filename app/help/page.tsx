// Public Help Center (no login needed, so people locked out can still read the sign-in help).
// Content lives in ./content.ts; the searchable UI is ./HelpCenter.tsx.
import type { Metadata } from "next";
import { Suspense } from "react";
import { HelpCenter } from "./HelpCenter";

export const metadata: Metadata = {
  title: "Help Center · ROrunner",
  description: "Guides, how-tos, troubleshooting and FAQs for ROrunner: repair orders, estimates, invoices and payments for auto repair shops.",
};

export default function HelpPage() {
  return (
    <Suspense fallback={null}>
      <HelpCenter />
    </Suspense>
  );
}
