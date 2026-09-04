"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";

export function QuoteRequestShortcut() {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  const [newCount, setNewCount] = useState(0);

  useEffect(() => {
    let active = true;

    async function refresh() {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      const hasSession = Boolean(data.session);
      setSignedIn(hasSession);
      if (!hasSession) {
        setNewCount(0);
        return;
      }
      const { count } = await supabase
        .from("quote_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "new");
      if (active) setNewCount(count ?? 0);
    }

    void refresh();
    const { data: listener } = supabase.auth.onAuthStateChange(() => void refresh());
    const timer = window.setInterval(() => void refresh(), 60000);

    return () => {
      active = false;
      window.clearInterval(timer);
      listener.subscription.unsubscribe();
    };
  }, []);

  if (!signedIn || pathname === "/quote-requests") return null;

  return (
    <a
      href="/quote-requests"
      className="no-print"
      style={{
        position: "fixed",
        right: 18,
        bottom: 18,
        zIndex: 1000,
        display: "inline-flex",
        alignItems: "center",
        gap: 9,
        padding: "11px 15px",
        borderRadius: 999,
        background: "#111827",
        color: "#fff",
        border: "1px solid #ef233c",
        boxShadow: "0 10px 30px rgba(0,0,0,.24)",
        textDecoration: "none",
        fontWeight: 800,
        fontSize: 14,
      }}
    >
      Quote Requests
      {newCount > 0 && (
        <span style={{ minWidth: 22, height: 22, padding: "0 6px", borderRadius: 999, background: "#ef233c", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>
          {newCount > 99 ? "99+" : newCount}
        </span>
      )}
    </a>
  );
}
