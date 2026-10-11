"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { isSafeRedirectPath } from "@workspace/core";
import { authClient } from "../../lib/auth-client";
import { IdentityShell } from "./identity-shell";
import {
  Alert, DeliveryNotice, E164, Field, PasswordMeter, Submit,
  authErrorMessage, hardReplace, identityApi, validatePassword,
} from "./ui";

export type SessionInfo = {
  user: { id: string; name: string; email: string; emailVerified: boolean; phoneNumber: string | null; phoneNumberVerified: boolean; twoFactorEnabled: boolean };
  organization: { key: string; displayName: string };
  roles: string[];
  permissions: string[];
  security: { needsAdminTwoFactor: boolean; hasVerifiedTotp: boolean; mfaFresh: boolean };
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** After a cookie is set, route through TOTP when admin access needs it. */
async function continueAfterSignIn(returnTo: string) {
  const safe = isSafeRedirectPath(returnTo);
  const s = await identityApi<SessionInfo>("/api/v1/identity/session");
  if (s.ok && s.data.security.needsAdminTwoFactor && !s.data.security.mfaFresh) {
    const mode = s.data.security.hasVerifiedTotp ? "challenge" : "setup";
    hardReplace(`/security/totp?mode=${mode}&returnTo=${encodeURIComponent(safe)}`);
    return;
  }
  hardReplace(safe);
}

export function LoginForm({ returnTo, notice }: { returnTo: string; notice?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const safe = isSafeRedirectPath(returnTo);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null); setUnverified(false);
    if (!EMAIL.test(email.trim())) return setError("Enter a valid email address.");
    if (!password) return setError("Enter your password.");
    setBusy(true);
    const { error: err } = await authClient.signIn.email({ email: email.trim().toLowerCase(), password });
    if (err) {
      setBusy(false);
      if (err.status === 403) { setUnverified(true); setError("Your email address is not verified yet."); return; }
      setError(authErrorMessage(err, "Email or password is incorrect."));
      return;
    }
    await continueAfterSignIn(safe);
  }

  return (
    <IdentityShell eyebrow="Sign in" title="Welcome back" sub="Use your email and password, or a one-time code sent to your phone.">
      <form className="id-form" onSubmit={submit} noValidate>
        {notice === "signed-out" && <Alert tone="success">You have been signed out.</Alert>}
        {notice === "reset" && <Alert tone="success">Password updated. Sign in with your new password.</Alert>}
        {error && (
          <Alert tone="error" title="Could not sign in">
            {error}{" "}
            {unverified && <Link className="id-link" href={`/verify-email?email=${encodeURIComponent(email.trim())}`}>Resend verification email</Link>}
          </Alert>
        )}
        <Field label="Email" type="email" inputMode="email" autoComplete="email" value={email} onChange={setEmail} required autoFocus />
        <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={setPassword} required maxLength={128} />
        <Submit busy={busy} label="Signing in">Sign in</Submit>
      </form>
      <div className="id-divider">or</div>
      <Link className="btn ghost" style={{ width: "100%", justifyContent: "center" }} href={`/phone-login?returnTo=${encodeURIComponent(safe)}`}>Sign in with phone code</Link>
      <div className="id-links">
        <Link href="/forgot-password">Forgot password?</Link>
        <Link href={`/register?returnTo=${encodeURIComponent(safe)}`}>Create an account</Link>
      </div>
    </IdentityShell>
  );
}

export function RegisterForm({ returnTo }: { returnTo: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const safe = isSafeRedirectPath(returnTo);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const fe: Record<string, string> = {};
    if (!name.trim() || name.trim().length > 120) fe.name = "Enter your name (up to 120 characters).";
    if (!EMAIL.test(email.trim()) || email.length > 254) fe.email = "Enter a valid email address.";
    const pe = validatePassword(password); if (pe) fe.password = pe;
    if (confirm !== password) fe.confirm = "Passwords do not match.";
    setFieldErr(fe);
    if (Object.keys(fe).length) return;
    setBusy(true);
    const addr = email.trim().toLowerCase();
    const { error: err } = await authClient.signUp.email({ name: name.trim(), email: addr, password, callbackURL: "/verify-email" });
    setBusy(false);
    if (err) return setError(authErrorMessage(err, "We could not create your account."));
    setDone(addr);
  }

  if (done) {
    return (
      <IdentityShell eyebrow="Almost there" title="Check your email" sub={<>We asked our delivery service to send a verification link to <b>{done}</b>.</>}>
        <div className="id-form">
          <DeliveryNotice />
          <Link className="btn primary" href={`/verify-email?email=${encodeURIComponent(done)}`}>Resend or check status</Link>
          <Link className="btn ghost" style={{ justifyContent: "center" }} href={`/login?returnTo=${encodeURIComponent(safe)}`}>Go to sign in</Link>
        </div>
      </IdentityShell>
    );
  }

  return (
    <IdentityShell eyebrow="Create account" title="Join Euro Infotech" sub="Shop from verified Indian sellers. Vendor and staff access is granted separately.">
      <form className="id-form" onSubmit={submit} noValidate>
        {error && <Alert tone="error" title="Registration failed">{error}</Alert>}
        <Field label="Full name" autoComplete="name" value={name} onChange={setName} error={fieldErr.name} required maxLength={120} autoFocus />
        <Field label="Email" type="email" inputMode="email" autoComplete="email" value={email} onChange={setEmail} error={fieldErr.email} required />
        <div className="id-field" style={{ gap: 8 }}>
          <Field label="Password" type="password" autoComplete="new-password" value={password} onChange={setPassword} error={fieldErr.password} required maxLength={128} minLength={12} />
          <PasswordMeter value={password} />
        </div>
        <Field label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} error={fieldErr.confirm} required maxLength={128} />
        <Submit busy={busy} label="Creating account">Create account</Submit>
      </form>
      <div className="id-links">
        <span style={{ color: "var(--muted)" }}>Already registered?</span>
        <Link href={`/login?returnTo=${encodeURIComponent(safe)}`}>Sign in</Link>
      </div>
    </IdentityShell>
  );
}

export function PhoneLoginForm({ returnTo }: { returnTo: string }) {
  const [phone, setPhone] = useState("+91");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const safe = isSafeRedirectPath(returnTo);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    setError(null); setInfo(null);
    const p = phone.replace(/[\s-]/g, "");
    if (!E164.test(p)) return setError("Enter the number in international format, for example +919876543210.");
    setBusy(true);
    const r = await identityApi<unknown>("/api/v1/identity/phone/send", "POST", { phoneNumber: p, purpose: "LOGIN" });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setPhone(p);
    setStep("code");
    setInfo("If this number can sign in, a code is on its way.");
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{4,8}$/.test(code)) return setError("Enter the numeric code from the SMS.");
    setBusy(true);
    const { error: err } = await authClient.phoneNumber.verify({ phoneNumber: phone, code });
    if (err) { setBusy(false); return setError(authErrorMessage(err, "That code is invalid or expired.")); }
    await continueAfterSignIn(safe);
  }

  return (
    <IdentityShell eyebrow="Phone sign-in" title={step === "phone" ? "Sign in with a code" : "Enter your code"} sub={step === "phone" ? "Works for numbers already verified on an account." : <>Sent to <b>{phone}</b>.</>}>
      <div className="id-steps" aria-hidden="true"><span className="on" /><span className={step === "code" ? "on" : ""} /></div>
      {step === "phone" ? (
        <form className="id-form" onSubmit={send} noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Mobile number" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={setPhone} hint="International format with country code." required autoFocus />
          <DeliveryNotice />
          <Submit busy={busy} label="Sending">Send code</Submit>
        </form>
      ) : (
        <form className="id-form" onSubmit={verify} noValidate>
          {info && <Alert tone="info">{info}</Alert>}
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="One-time code" code inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 8))} required autoFocus />
          <Submit busy={busy} label="Verifying">Verify and sign in</Submit>
          <div className="id-row">
            <button type="button" className="btn ghost small" onClick={() => { setStep("phone"); setCode(""); setError(null); }}>Change number</button>
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => send()}>Resend code</button>
          </div>
        </form>
      )}
      <div className="id-links"><Link href={`/login?returnTo=${encodeURIComponent(safe)}`}>Use email instead</Link></div>
    </IdentityShell>
  );
}

export function VerifyEmailPanel({ email: initialEmail, error: urlError }: { email: string; error?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<"unknown" | "verified" | "unverified" | "signed-out">("unknown");

  async function resend(e: FormEvent) {
    e.preventDefault();
    setError(null); setSent(false);
    if (!EMAIL.test(email.trim())) return setError("Enter a valid email address.");
    setBusy(true);
    const { error: err } = await authClient.sendVerificationEmail({ email: email.trim().toLowerCase(), callbackURL: "/verify-email" });
    setBusy(false);
    if (err) return setError(authErrorMessage(err, "We could not request a new link."));
    setSent(true);
  }

  async function check() {
    setChecking(true);
    const r = await identityApi<SessionInfo>("/api/v1/identity/session");
    setChecking(false);
    if (!r.ok) return setStatus(r.status === 401 ? "signed-out" : "unknown");
    setStatus(r.data.user.emailVerified ? "verified" : "unverified");
  }

  return (
    <IdentityShell eyebrow="Email verification" title="Verify your email" sub="Verification confirms you own the address before it can be used to sign in or recover your account.">
      <div className="id-form">
        {urlError && <Alert tone="error" title="Link not accepted">{urlError === "invalid_token" || urlError === "token_expired" ? "This verification link is invalid or has expired. Request a new one below." : urlError}</Alert>}
        {status === "verified" && <Alert tone="success" title="Verified">Your email address is confirmed. <Link className="id-link" href="/account/security">Go to account security</Link></Alert>}
        {status === "unverified" && <Alert tone="warn">Your email is not verified yet. Open the link from your inbox or request a new one.</Alert>}
        {status === "signed-out" && <Alert tone="info">Sign in to see your verification status. <Link className="id-link" href="/login?returnTo=%2Fverify-email">Sign in</Link></Alert>}
        <button type="button" className="btn ghost" style={{ justifyContent: "center" }} onClick={check} disabled={checking}>{checking ? "Checking" : "Check my status"}</button>
      </div>
      <div className="id-divider">resend link</div>
      <form className="id-form" onSubmit={resend} noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        {sent && <Alert tone="success">If the address belongs to an unverified account, a new link has been requested.</Alert>}
        <Field label="Email" type="email" inputMode="email" autoComplete="email" value={email} onChange={setEmail} required />
        <DeliveryNotice />
        <Submit busy={busy} label="Requesting">Send new link</Submit>
      </form>
      <div className="id-links"><Link href="/login">Back to sign in</Link></div>
    </IdentityShell>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!EMAIL.test(email.trim())) return setError("Enter a valid email address.");
    setBusy(true);
    const { error: err } = await authClient.requestPasswordReset({ email: email.trim().toLowerCase(), redirectTo: "/reset-password" });
    setBusy(false);
    if (err) return setError(authErrorMessage(err, "We could not request a reset link."));
    setSent(true);
  }

  return (
    <IdentityShell eyebrow="Recovery" title="Reset your password" sub="We will send a single-use reset link to the email on your account.">
      {sent ? (
        <div className="id-form">
          <Alert tone="success" title="Request received">If an account exists for that address, a reset link has been requested. It expires shortly.</Alert>
          <DeliveryNotice />
          <button type="button" className="btn ghost" onClick={() => setSent(false)}>Use a different email</button>
        </div>
      ) : (
        <form className="id-form" onSubmit={submit} noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Email" type="email" inputMode="email" autoComplete="email" value={email} onChange={setEmail} required autoFocus />
          <Submit busy={busy} label="Requesting">Send reset link</Submit>
        </form>
      )}
      <div className="id-links"><Link href="/login">Back to sign in</Link><Link href="/phone-login">Sign in with phone</Link></div>
    </IdentityShell>
  );
}

export function ResetPasswordForm({ token, error: urlError }: { token: string; error?: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const f: Record<string, string> = {};
    const pe = validatePassword(password); if (pe) f.password = pe;
    if (password !== confirm) f.confirm = "Passwords do not match.";
    setFe(f);
    if (Object.keys(f).length) return;
    setBusy(true);
    const { error: err } = await authClient.resetPassword({ newPassword: password, token });
    if (err) { setBusy(false); return setError(authErrorMessage(err, "This reset link is invalid or has expired.")); }
    hardReplace("/login?notice=reset", "/login");
  }

  if (!token || urlError) {
    return (
      <IdentityShell eyebrow="Recovery" title="Link not usable" sub="Reset links are single-use and expire quickly.">
        <div className="id-form">
          <Alert tone="error">{urlError === "INVALID_TOKEN" || !token ? "This reset link is invalid or has expired." : urlError}</Alert>
          <Link className="btn primary" href="/forgot-password">Request a new link</Link>
        </div>
      </IdentityShell>
    );
  }

  return (
    <IdentityShell eyebrow="Recovery" title="Choose a new password" sub="Other signed-in devices may be signed out after the change.">
      <form className="id-form" onSubmit={submit} noValidate>
        {error && <Alert tone="error">{error} <Link className="id-link" href="/forgot-password">Request a new link</Link></Alert>}
        <div className="id-field" style={{ gap: 8 }}>
          <Field label="New password" type="password" autoComplete="new-password" value={password} onChange={setPassword} error={fe.password} required maxLength={128} autoFocus />
          <PasswordMeter value={password} />
        </div>
        <Field label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} error={fe.confirm} required maxLength={128} />
        <Submit busy={busy} label="Saving">Update password</Submit>
      </form>
    </IdentityShell>
  );
}

export function AccessDenied({ reason, returnTo }: { reason?: string; returnTo?: string }) {
  const safe = isSafeRedirectPath(returnTo, "/");
  const [busy, setBusy] = useState(false);
  async function switchAccount() {
    setBusy(true);
    await authClient.signOut();
    hardReplace(`/login?returnTo=${encodeURIComponent(safe)}`, "/login");
  }
  const msg = reason === "mfa" ? "This area requires a fresh authenticator check."
    : reason === "role" ? "Your account does not have a role that grants this area."
    : "Your account is signed in but lacks permission for this page.";
  return (
    <IdentityShell eyebrow="403" title="Access denied" sub={msg}>
      <div className="id-form">
        <Alert tone="info">If you believe this is wrong, ask your organisation owner to review your roles. Vendor roles remain pending until approved.</Alert>
        {reason === "mfa" && <Link className="btn primary" href={`/security/totp?mode=challenge&returnTo=${encodeURIComponent(safe)}`}>Verify with authenticator</Link>}
        <Link className="btn ghost" style={{ justifyContent: "center" }} href="/account/security">Account security</Link>
        <button type="button" className="btn ghost" style={{ justifyContent: "center" }} onClick={switchAccount} disabled={busy}>{busy ? "Signing out" : "Sign in as someone else"}</button>
        <Link className="id-link" href="/">Return home</Link>
      </div>
    </IdentityShell>
  );
}
