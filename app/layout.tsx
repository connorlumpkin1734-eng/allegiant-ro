import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ROrunner",
  description: "Repair orders, estimates and invoices for independent auto repair shops.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved light/dark choice before first paint so there is no flash of the wrong one. */}
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('ui-theme')||'light';var d={midnight:1,graphite:1,ocean:1,forest:1,dark:1};var m=t==='system'?(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):(d[t]?'dark':'light');document.documentElement.setAttribute('data-theme',m)}catch(e){}" }} />
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
