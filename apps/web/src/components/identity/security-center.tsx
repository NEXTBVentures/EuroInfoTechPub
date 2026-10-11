"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { authClient } from "../../lib/auth-client";
import type { SessionInfo } from "./auth-forms";
import { IdentityArea } from "./identity-area";
import { Alert, DeliveryNotice, E164, Field, Submit, authErrorMessage, hardReplace, identityApi, redirectForStatus, useBfcacheGuard } from "./ui";

type SecurityInfo = {
  user: { name: string; email: string; twoFactorEnabled: boolean };
  sessions: { id: string; createdAt: string; expiresAt: string; userAgent: string | null; current: boolean }[];
  recoveryCodesRemaining: number;
  adminTwoFactorRequired: boolean;
};

const fmt = (d: string) => { try { return new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }); } catch { return d; } };
function device(ua: string | null) {
  if (!ua) return "Unknown device";
  const b = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const o = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return o ? `${b} on ${o}` : b;
}

function Reauth({ needCode, onCancel, onSubmit, busy, confirmLabel, danger }: { needCode: boolean; onCancel: () => void; onSubmit: (p: string, c: string) => void; busy: boolean; confirmLabel: string; danger?: boolean }) {
  const [p, setP] = useState(""); const [c, setC] = useState(""); const [err, setErr] = useState<string | null>(null);
  function go(e: FormEvent) {
    e.preventDefault();
    if (!p) return setErr("Enter your password.");
    if (needCode && !/^\d{6}$/.test(c)) return setErr("Enter your 6-digit authenticator code.");
    setErr(null); onSubmit(p, c);
  }
  return (
    <form className="reauth" onSubmit={go} noValidate>
      {err && <Alert tone="error">{err}</Alert>}
      <Field label="Password" type="password" autoComplete="current-password" value={p} onChange={setP} required autoFocus maxLength={128} />
      {needCode && <Field label="Authenticator code" code inputMode="numeric" autoComplete="one-time-code" value={c} onChange={(v) => setC(v.replace(/\D/g, "").slice(0, 6))} required />}
      <div className="id-row end">
        <button type="button" className="btn ghost small" onClick={onCancel}>Cancel</button>
        <Submit busy={busy} className={`btn small${danger ? " danger" : ""}`} label="Confirming">{confirmLabel}</Submit>
      </div>
    </form>
  );
}

function PhonePanel({ session, totp }: { session: SessionInfo; totp: boolean }) {
  const [phone, setPhone] = useState(session.user.phoneNumber ?? "+91");
  const [step, setStep] = useState<"idle" | "auth" | "code">("idle");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [linked, setLinked] = useState(session.user.phoneNumberVerified ? session.user.phoneNumber : null);

  async function send(password: string, code: string) {
    setError(null);
    const p = phone.replace(/[\s-]/g, "");
    if (!E164.test(p)) return setError("Enter the number in international format, for example +919876543210.");
    setBusy(true);
    const r = await identityApi<unknown>("/api/v1/identity/phone/send", "POST", { phoneNumber: p, purpose: "LINK", password, ...(code ? { code } : {}) });
    setBusy(false);
    if (!r.ok) { if (r.status === 401 || r.status === 428) { redirectForStatus(r.status, r.error); return; } return setError(r.error); }
    setPhone(p); setStep("code");
  }
  async function verify(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!/^\d{4,8}$/.test(otp)) return setError("Enter the numeric code from the SMS.");
    setBusy(true);
    const { error: err } = await authClient.phoneNumber.verify({ phoneNumber: phone, code: otp, updatePhoneNumber: true });
    setBusy(false);
    if (err) return setError(authErrorMessage(err, "That code is invalid or expired."));
    setLinked(phone); setStep("idle"); setOtp(""); setOk("Phone number verified and linked.");
  }

  return (
    <section className="panel">
      <h3>Phone number</h3>
      <p className="sub">Used for one-time-code sign-in.</p>
      {ok && <Alert tone="success">{ok}</Alert>}
      <dl className="kv"><dt>Linked</dt><dd>{linked ?? "None"}</dd></dl>
      {error && <div style={{ marginTop: 12 }}><Alert tone="error">{error}</Alert></div>}
      {step === "idle" && <div style={{ marginTop: 12 }}><button className="btn small" type="button" onClick={() => { setOk(null); setStep("auth"); }}>{linked ? "Change number" : "Link a number"}</button></div>}
      {step === "auth" && (
        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
          <Field label="Mobile number" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={setPhone} hint="International format with country code." />
          <DeliveryNotice />
          <Reauth needCode={totp} busy={busy} confirmLabel="Send code" onCancel={() => setStep("idle")} onSubmit={send} />
        </div>
      )}
      {step === "code" && (
        <form className="reauth" onSubmit={verify} noValidate>
          <Alert tone="info">Code requested for {phone}.</Alert>
          <Field label="SMS code" code inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(v) => setOtp(v.replace(/\D/g, "").slice(0, 8))} required autoFocus />
          <div className="id-row end">
            <button type="button" className="btn ghost small" onClick={() => setStep("auth")}>Back</button>
            <Submit busy={busy} className="btn small" label="Verifying">Verify</Submit>
          </div>
        </form>
      )}
    </section>
  );
}

function SecurityBody({ session }: { session: SessionInfo }) {
  const [info, setInfo] = useState<SecurityInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadErr(null);
    const r = await identityApi<SecurityInfo>("/api/v1/identity/security");
    if (!r.ok) {
      if (redirectForStatus(r.status, r.error)) return;
      return setLoadErr(r.error);
    }
    setInfo(r.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(body: Record<string, unknown>, success: string, after?: () => void) {
    setBusy(true); setError(null); setOk(null);
    const r = await identityApi<unknown>("/api/v1/identity/security", "POST", body);
    setBusy(false);
    if (!r.ok) {
      if (r.status === 401 || r.status === 428) { redirectForStatus(r.status, r.error); return; }
      return setError(r.error);
    }
    setOpen(null); setOk(success);
    if (after) after(); else void load();
  }

  if (loadErr) return <div className="err" role="alert" style={{ marginTop: 20 }}><span>{loadErr}</span><button type="button" className="btn small" onClick={load}>Retry</button></div>;
  if (!info) return <div className="sec-grid" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="panel"><div className="sk" style={{ width: "50%" }} /><div className="sk" /><div className="sk" style={{ width: "70%" }} /></div>)}</div>;

  const totp = info.user.twoFactorEnabled;
  return (
    <>
      <div aria-live="polite" style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {error && <Alert tone="error">{error}</Alert>}
        {ok && <Alert tone="success">{ok}</Alert>}
        {info.adminTwoFactorRequired && !totp && <Alert tone="warn" title="Authenticator required">Your role requires an authenticator app before admin areas will open.</Alert>}
      </div>
      <div className="sec-grid">
        <section className="panel">
          <h3>Sign-in details</h3>
          <p className="sub">Your primary identity.</p>
          <dl className="kv">
            <dt>Name</dt><dd>{info.user.name}</dd>
            <dt>Email</dt><dd>{info.user.email}</dd>
            <dt>Status</dt><dd><span className={`pill ${session.user.emailVerified ? "ok" : "warn"}`}>{session.user.emailVerified ? "Verified" : "Unverified"}</span></dd>
          </dl>
          <div className="id-row" style={{ marginTop: 12 }}>
            {!session.user.emailVerified && <Link className="btn small" href={`/verify-email?email=${encodeURIComponent(info.user.email)}`}>Verify email</Link>}
            <Link className="btn ghost small" href="/forgot-password">Reset password</Link>
          </div>
        </section>

        <section className="panel">
          <h3>Authenticator app</h3>
          <p className="sub">Time-based codes protect sensitive actions{info.adminTwoFactorRequired ? " and are mandatory for your admin role" : ""}.</p>
          <dl className="kv">
            <dt>Status</dt><dd><span className={`pill ${totp ? "ok" : "bad"}`}>{totp ? "On" : "Off"}</span></dd>
            {totp && <><dt>Recovery codes left</dt><dd>{info.recoveryCodesRemaining}</dd></>}
          </dl>
          {totp && info.recoveryCodesRemaining <= 2 && <div style={{ marginTop: 12 }}><Alert tone="warn">
            {info.adminTwoFactorRequired
              ? "Few recovery codes remain. Keep your authenticator available. Administrator roles must be removed before re-enrolment."
              : "Few recovery codes remain. Remove and re-enrol your authenticator to get a fresh set."}
          </Alert></div>}
          <div className="id-row" style={{ marginTop: 12 }}>
            {!totp && <Link className="btn small" href="/security/totp?mode=setup&returnTo=%2Faccount%2Fsecurity">Set up authenticator</Link>}
            {totp && open !== "remove" && <button type="button" className="btn danger small" onClick={() => setOpen("remove")} disabled={info.adminTwoFactorRequired} title={info.adminTwoFactorRequired ? "Required while you hold an admin role" : undefined}>Remove authenticator</button>}
          </div>
          {totp && info.adminTwoFactorRequired && <p className="sub" style={{ marginTop: 8 }}>Removal is blocked while you hold an admin role.</p>}
          {open === "remove" && <Reauth needCode busy={busy} danger confirmLabel="Remove" onCancel={() => setOpen(null)} onSubmit={(password, code) => act({ action: "remove", password, code }, "Authenticator removed.")} />}
        </section>

        <PhonePanel session={session} totp={totp} />

        <section className="panel full">
          <div className="id-row" style={{ justifyContent: "space-between" }}>
            <div><h3>Active sessions</h3><p className="sub" style={{ margin: 0 }}>Devices currently signed in to your account.</p></div>
            {open !== "all" && <button type="button" className="btn danger small" onClick={() => setOpen("all")}>Sign out everywhere</button>}
          </div>
          {open === "all" && <Reauth needCode={totp} busy={busy} danger confirmLabel="Sign out all" onCancel={() => setOpen(null)} onSubmit={(password, code) => act({ action: "revokeAll", password, ...(code ? { code } : {}) }, "All sessions ended.", () => hardReplace("/login?notice=signed-out", "/login"))} />}
          <div className="sess" style={{ marginTop: 14 }}>
            {info.sessions.length === 0 && <div className="empty">No active sessions found.</div>}
            {info.sessions.map((s) => (
              <div key={s.id}>
                <div className={`sess-item${s.current ? " current" : ""}`}>
                  <div>
                    <b>{device(s.userAgent)} {s.current && <span className="pill ok" style={{ marginLeft: 6 }}>This device</span>}</b>
                    <small>Started {fmt(s.createdAt)} / Expires {fmt(s.expiresAt)}</small>
                  </div>
                  {open !== s.id && <button type="button" className="btn ghost small" onClick={() => setOpen(s.id)}>{s.current ? "Sign out" : "Revoke"}</button>}
                </div>
                {open === s.id && <Reauth needCode={totp} busy={busy} danger confirmLabel="Revoke session" onCancel={() => setOpen(null)} onSubmit={(password, code) => act({ action: "revokeOne", sessionId: s.id, password, ...(code ? { code } : {}) }, "Session revoked.", s.current ? () => hardReplace("/login?notice=signed-out", "/login") : undefined)} />}
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function areaFor(roles: string[]): "Customer" | "Vendor" | "Admin" {
  if (roles.includes("ORGANISATION_OWNER") || roles.includes("ADMIN_STAFF")) return "Admin";
  if (roles.includes("VENDOR_OWNER") || roles.includes("VENDOR_STAFF")) return "Vendor";
  return "Customer";
}

export function SecurityCenter() {
  useBfcacheGuard(true);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    setErr(null);
    const r = await identityApi<SessionInfo>("/api/v1/identity/session");
    if (!r.ok) { if (redirectForStatus(r.status, r.error)) return; return setErr(r.error); }
    setSession(r.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (err) return <div className="ia"><div className="err" role="alert"><span>{err}</span><button type="button" className="btn small" onClick={load}>Retry</button></div></div>;
  if (!session) return <div className="ia" aria-busy="true" aria-label="Loading account"><div className="sk" style={{ width: "40%", height: 24 }} /><div className="sk" /><div className="sk" style={{ width: "70%" }} /></div>;
  return (
    <IdentityArea area={areaFor(session.roles)} name={session.user.name || session.user.email} organizationName={session.organization.displayName} roles={session.roles} permissions={session.permissions}>
      <h2 style={{ margin: "0 0 4px", fontSize: 26, letterSpacing: "-0.02em" }}>Account security</h2>
      {session.security.needsAdminTwoFactor && !session.security.mfaFresh && session.security.hasVerifiedTotp && (
        <Alert tone="warn">Admin areas need a fresh check. <Link className="id-link" href="/security/totp?mode=challenge&returnTo=%2Faccount%2Fsecurity">Verify with authenticator</Link></Alert>
      )}
      <SecurityBody session={session} />
    </IdentityArea>
  );
}
