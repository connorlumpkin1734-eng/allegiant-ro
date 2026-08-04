import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Allegiant Auto Care RO",
  description: "Repair orders, estimates, and invoices for Allegiant Auto Care",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
