"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // The link Supabase emails carries a recovery token in the URL. The client library
    // (detectSessionInUrl: true) parses it automatically and fires PASSWORD_RECOVERY once
    // it's established a temporary session we can use to set a new password.
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });

    // If the tab was already open when the link redirected here, the event may have already
    // fired before this listener was attached — fall back to checking for a live session.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });

    // Give the client a moment to process the URL fragment before deciding the link is bad.
    const timeout = setTimeout(() => {
      supabase.auth.getSession().then(({ data }) => {
        if (!data.session) setInvalid(true);
      });
    }, 2500);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    if (password.length < 6) {
      setMessage("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setMessage("Passwords do not match.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setDone(true);
    await supabase.auth.signOut();
  }

  if (done) {
    return (
      <main className="auth-shell">
        <section className="auth-card" style={{ textAlign: "center" }}>
          <h1>Password updated</h1>
          <p className="muted">You can sign in with your new password now.</p>
          <a className="button primary" href="/" style={{ display: "inline-block", marginTop: 12, textDecoration: "none" }}>
            Back to sign in
          </a>
        </section>
      </main>
    );
  }

  if (invalid) {
    return (
      <main className="auth-shell">
        <section className="auth-card" style={{ textAlign: "center" }}>
          <h1>Link expired</h1>
          <p className="muted">This password reset link is invalid or has expired. Request a new one from the sign-in screen.</p>
          <a className="button primary" href="/" style={{ display: "inline-block", marginTop: 12, textDecoration: "none" }}>
            Back to sign in
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>Set a new password</h1>
        {!ready ? (
          <p className="muted">Verifying your reset link…</p>
        ) : (
          <form onSubmit={submit} className="stack">
            <label>
              New password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </label>
            <label>
              Confirm new password
              <input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </label>
            {message && <div className="notice">{message}</div>}
            <button className="button primary" disabled={busy} type="submit">
              {busy ? "Working…" : "Update password"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
