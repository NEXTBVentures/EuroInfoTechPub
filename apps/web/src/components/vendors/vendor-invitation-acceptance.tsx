"use client";

import { useState } from "react";
import "./vendors.css";

export function VendorInvitationAcceptance({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);

  async function accept() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/vendor/staff", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const messages: Record<string, string> = {
          authentication_required: "Sign in with the account whose verified email address or phone number received this invitation.",
          contact_mismatch: "This signed-in account does not match the invited verified email address or phone number.",
          invalid_invitation: "This invitation is invalid, expired, already used, or revoked.",
          vendor_inactive: "This vendor account is not currently active.",
        };
        throw new Error(messages[data.error] || data.error || `Request failed (${response.status}).`);
      }
      setAccepted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The invitation could not be accepted.");
    } finally {
      setBusy(false);
    }
  }

  const returnTo = `/vendor/invitations/${encodeURIComponent(token)}`;

  return <main className="vw" style={{ maxWidth: 720, margin: "48px auto", padding: 20 }}>
    <header className="v-head"><div><span className="v-eyebrow">Euro Infotech · staff access</span>
      <h1>{accepted ? "Invitation accepted" : "Accept vendor invitation"}</h1></div></header>
    {accepted ? <section className="v-panel" role="status">
      <h2>Vendor access is active</h2>
      <p>This one-time invitation has been accepted for the signed-in account.</p>
      <a className="v-btn primary" href="/vendor">Open vendor workspace</a>
    </section> : <section className="v-panel">
      <p>This private link can be used once. You must sign in with the verified email address or phone number to which the vendor sent the invitation.</p>
      {error && <div className="v-note error" role="alert">{error}</div>}
      <div className="v-actions" style={{ marginTop: 18 }}>
        <button type="button" className="v-btn primary" disabled={busy} onClick={() => void accept()}>{busy ? "Checking invitation…" : "Accept invitation"}</button>
        <a className="v-btn" href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in</a>
      </div>
      <p className="v-doc-meta" style={{ marginTop: 16 }}>The invitation token is not shown here and is stored only as a hash by the service.</p>
    </section>}
  </main>;
}
