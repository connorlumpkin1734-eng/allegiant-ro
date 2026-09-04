import type { Metadata } from "next";
import "./globals.css";
import { QuoteRequestShortcut } from "@/components/QuoteRequestShortcut";

export const metadata: Metadata = {
  title: "Allegiant Auto Care RO",
  description: "Repair orders, estimates, invoices, and website quote requests for Allegiant Auto Care",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <QuoteRequestShortcut />
      </body>
    </html>
  );
}
