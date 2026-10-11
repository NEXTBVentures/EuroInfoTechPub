"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { isSafeRedirectPath } from "@workspace/core";
import { IdentityShell } from "./identity-shell";
import { Alert, Field, Submit, hardReplace, identityApi } from "./ui";

export function RecoveryCodes({ codes, onDone, doneLabel = "I have saved these codes" }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  const [copied, setCopied] = useState(false);
  const [ack, setAck] = useState(false);
  const text = `Euro Infotech recovery codes\nEach code works once.\n\n${codes.join("\n")}\n`;
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url; a.download = "euro-infotech-recovery-codes.txt";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="id-form">
      <Alert tone="warn" title="Shown only once">Store these somewhere safe. Each one signs you in once if you lose your authenticator. They will not be displayed again.</Alert>
      <ul className="id-codes" aria-label="Recovery codes">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <div className="id-row">
        <button type="button" className="btn ghost small" onClick={copy}>{copied ? "Copied" : "Copy all"}</button>
        <button type="button" className="btn ghost small" onClick={download}>Download .txt</button>
      </div>
      <label className="id-row" style={{ fontSize: 13 }}>
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I have stored my recovery codes
      </label>
      <button type="button" className="btn primary" disabled={!ack} onClick={onDone}>{doneLabel}</button>
    </div>
  );
}

export function TotpFlow({ mode, returnTo }: { mode: string; returnTo: string }) {
  const safe = isSafeRedirectPath(returnTo);
  const isSetup = mode === "setup";
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<{ otpauthUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleAuthFail(status: number, msg: string) {
    if (status === 401 && msg === "authentication_required") return hardReplace(`/login?returnTo=${encodeURIComponent(`/security/totp?mode=${isSetup ? "setup" : "challenge"}&returnTo=${safe}`)}`, "/login");
    setError(msg);
  }

  async function enrol(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!password) return setError("Enter your password to continue.");
    setBusy(true);
    const r = await identityApi<{ otpauthUrl: string; secret: string }>("/api/v1/identity/security", "POST", { action: "enrol", password });
    setBusy(false); setPassword("");
    if (!r.ok) return handleAuthFail(r.status, r.error);
    setPending(r.data);
  }

  async function verify(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code from your authenticator app.");
    setBusy(true);
    const r = await identityApi<{ recoveryCodes?: string[] }>("/api/v1/identity/security", "POST", { action: "verify", code });
    setBusy(false); setCode("");
    if (!r.ok) return handleAuthFail(r.status, r.error);
    setPending(null);
    if (r.data?.recoveryCodes?.length) setCodes(r.data.recoveryCodes);
    else hardReplace(safe);
  }

  async function recover(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!recovery.trim()) return setError("Enter one of your recovery codes.");
    setBusy(true);
    const r = await identityApi<unknown>("/api/v1/identity/security", "POST", { action: "recover", recoveryCode: recovery.trim() });
    setBusy(false); setRecovery("");
    if (!r.ok) return handleAuthFail(r.status, r.error);
    hardReplace(safe);
  }

  if (codes) {
    return (
      <IdentityShell eyebrow="Authenticator active" title="Save your recovery codes">
        <RecoveryCodes codes={codes} onDone={() => { setCodes(null); hardReplace(safe); }} doneLabel="Continue" />
      </IdentityShell>
    );
  }

  if (isSetup) {
    return (
      <IdentityShell eyebrow="Two-step verification" title="Set up your authenticator" sub="Use any TOTP app such as Google Authenticator, Microsoft Authenticator or 1Password. Required for admin access.">
        <div className="id-steps" aria-hidden="true"><span className="on" /><span className={pending ? "on" : ""} /><span /></div>
        {!pending ? (
          <form className="id-form" onSubmit={enrol} noValidate>
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="Confirm your password" type="password" autoComplete="current-password" value={password} onChange={setPassword} required autoFocus maxLength={128} />
            <Submit busy={busy} label="Preparing">Start setup</Submit>
          </form>
        ) : (
          <form className="id-form" onSubmit={verify} noValidate>
            {error && <Alert tone="error">{error}</Alert>}
            <div className="id-field">
              <label>Add to your app</label>
              <a className="btn ghost" style={{ justifyContent: "center" }} href={pending.otpauthUrl}>Open in authenticator app</a>
              <span className="hint">On another device? Enter this key manually:</span>
              <div className="id-secret" aria-label="Manual setup key">{pending.secret.replace(/(.{4})/g, "$1 ").trim()}</div>
            </div>
            <Field label="6-digit code" code inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} required autoFocus />
            <Submit busy={busy} label="Verifying">Verify and turn on</Submit>
            <button type="button" className="btn ghost small" onClick={() => { setPending(null); setCode(""); }}>Start over</button>
          </form>
        )}
        <div className="id-links"><Link href={safe}>Cancel</Link></div>
      </IdentityShell>
    );
  }

  return (
    <IdentityShell eyebrow="Two-step verification" title="Confirm it is you" sub="Enter the current code from your authenticator app to continue to protected areas.">
      {!useRecovery ? (
        <form className="id-form" onSubmit={verify} noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="6-digit code" code inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} required autoFocus />
          <Submit busy={busy} label="Verifying">Verify</Submit>
          <button type="button" className="btn ghost small" onClick={() => { setUseRecovery(true); setError(null); }}>Lost your device? Use a recovery code</button>
        </form>
      ) : (
        <form className="id-form" onSubmit={recover} noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Recovery code" autoComplete="off" value={recovery} onChange={setRecovery} required autoFocus hint="Each recovery code can only be used once." />
          <Submit busy={busy} label="Checking">Use recovery code</Submit>
          <button type="button" className="btn ghost small" onClick={() => { setUseRecovery(false); setError(null); }}>Use authenticator code</button>
        </form>
      )}
      <div className="id-links"><Link href="/account/security">Account security</Link><Link href="/">Home</Link></div>
    </IdentityShell>
  );
}
