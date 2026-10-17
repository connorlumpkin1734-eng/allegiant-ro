import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Allegiant Auto Care RO",
  description: "Repair orders, estimates, and invoices for Allegiant Auto Care",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved color theme before first paint so there is no flash of the default theme. */}
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('ui-theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}" }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* Extra families used only by the optional invoice/estimate templates. */}
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@600;700;800&family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
