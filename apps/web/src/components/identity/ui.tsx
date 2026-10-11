"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { isSafeRedirectPath } from "@workspace/core";
import "../../app/identity.css";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export async function identityApi<T>(path: string, method: "GET" | "POST" | "DELETE" = "GET", body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let json: unknown = null;
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok) {
      const msg = json && typeof json === "object" && "error" in json
        ? String((json as { error: unknown }).error)
        : res.status === 429 ? "Too many attempts. Please wait before trying again."
        : res.status === 503 ? "The delivery provider is currently disabled."
        : `Request failed (${res.status}).`;
      return { ok: false, status: res.status, error: msg };
    }
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, status: 0, error: "Network error. Check your connection and try again." };
  }
}

export function authErrorMessage(err: { message?: string; status?: number } | null | undefined, fallback: string): string {
  if (!err) return fallback;
  if (err.status === 429) return "Too many attempts. Please wait before trying again.";
  return err.message || fallback;
}

/** Full navigation so browser history never shows stale protected content. */
export function hardReplace(target: string | null | undefined, fallback = "/account") {
  window.location.replace(isSafeRedirectPath(target, fallback));
}

/** Reload restored pages so cached history never re-shows protected data. */
export function useBfcacheGuard(includePopstate = false) {
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) window.location.reload(); };
    const onPop = () => window.location.reload();
    window.addEventListener("pageshow", onShow);
    if (includePopstate) window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("pageshow", onShow);
      if (includePopstate) window.removeEventListener("popstate", onPop);
    };
  }, [includePopstate]);
}

/** Full redirect for protected API statuses. Returns true when navigating away. */
export function redirectForStatus(status: number, error?: string): boolean {
  const here = encodeURIComponent(window.location.pathname + window.location.search);
  if (status === 401 && !["reauthentication_failed", "invalid_two_factor_code", "invalid_recovery_code"].includes(error ?? "")) {
    hardReplace(`/login?returnTo=${here}`, "/login"); return true;
  }
  if (status === 403 && error === "enrollment_required") { hardReplace(`/security/totp?mode=setup&returnTo=${here}`); return true; }
  if (status === 403) { hardReplace(`/access-denied?returnTo=${here}`, "/access-denied"); return true; }
  if (status === 428) { hardReplace(`/security/totp?mode=challenge&returnTo=${here}`); return true; }
  return false;
}

export const E164 = /^\+[1-9]\d{7,14}$/;
export const PW_MIN = 12;
export const PW_MAX = 128;

export function Alert({ tone, title, children }: { tone: "error" | "success" | "info" | "warn"; title?: string; children?: ReactNode }) {
  return (
    <div className={`id-alert ${tone}`} role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"}>
      {title && <strong>{title}</strong>}
      {children}
    </div>
  );
}

export function DeliveryNotice() {
  return (
    <Alert tone="warn" title="Delivery may be unavailable">
      This environment uses local or test message delivery. If the provider is disabled, no email or SMS will arrive. Contact support if nothing reaches you.
    </Alert>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  inputMode?: "numeric" | "tel" | "email" | "text";
  maxLength?: number;
  minLength?: number;
  code?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
};

export function Field(p: FieldProps) {
  const id = useId();
  const [show, setShow] = useState(false);
  const isPw = p.type === "password";
  const describedBy = [p.hint ? `${id}-h` : "", p.error ? `${id}-e` : ""].filter(Boolean).join(" ") || undefined;
  const input = (
    <input
      id={id}
      className={`id-input${p.code ? " code" : ""}`}
      type={isPw && show ? "text" : p.type ?? "text"}
      value={p.value}
      onChange={(e) => p.onChange(e.target.value)}
      autoComplete={p.autoComplete}
      required={p.required}
      inputMode={p.inputMode}
      maxLength={p.maxLength}
      minLength={p.minLength}
      placeholder={p.placeholder}
      autoFocus={p.autoFocus}
      aria-invalid={p.error ? true : undefined}
      aria-describedby={describedBy}
    />
  );
  return (
    <div className="id-field">
      <label htmlFor={id}>{p.label}</label>
      {isPw ? (
        <div className="id-pw">
          {input}
          <button type="button" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-label={show ? "Hide password" : "Show password"}>
            {show ? "Hide" : "Show"}
          </button>
        </div>
      ) : input}
      {p.hint && <span className="hint" id={`${id}-h`}>{p.hint}</span>}
      {p.error && <span className="ferr" id={`${id}-e`}>{p.error}</span>}
    </div>
  );
}

export function Submit({ busy, children, label, className = "btn primary", disabled }: { busy: boolean; children: ReactNode; label?: string; className?: string; disabled?: boolean }) {
  return (
    <button type="submit" className={className} disabled={busy || disabled} aria-busy={busy}>
      {busy ? (
        <>
          <svg className="spin" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" /></svg>
          {label ?? "Working"}
        </>
      ) : children}
    </button>
  );
}

export function PasswordMeter({ value }: { value: string }) {
  let score = 0;
  if (value.length >= PW_MIN) score++;
  if (value.length >= 16) score++;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score++;
  const labels = ["Too short", "Acceptable", "Good", "Strong", "Very strong"];
  return (
    <div aria-live="polite">
      <div className="id-meter" aria-hidden="true"><i style={{ transform: `scaleX(${Math.max(score, value ? 0.5 : 0) / 4})` }} /></div>
      <span className="hint" style={{ fontSize: 12, color: "var(--muted)" }}>
        {value ? labels[score] : `At least ${PW_MIN} characters. Passphrases work well.`} {value.length > 0 && `(${value.length}/${PW_MAX})`}
      </span>
    </div>
  );
}

export function validatePassword(pw: string): string | null {
  if (pw.length < PW_MIN) return `Use at least ${PW_MIN} characters.`;
  if (pw.length > PW_MAX) return `Use no more than ${PW_MAX} characters.`;
  return null;
}
