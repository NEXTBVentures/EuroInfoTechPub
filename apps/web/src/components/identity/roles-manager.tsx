"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { roleLabel } from "./identity-area";
import { Alert, Field, Submit, identityApi, redirectForStatus } from "./ui";
import "../../app/identity.css";

type Member = { userId: string; name: string; email: string; roles: { id: string; roleKey: string; vendorId: string | null; approved: boolean }[] };
type RolesData = { members: Member[]; roleKeys: string[] };
type Pending = { method: "POST" | "DELETE"; userId: string; roleKey: string; vendorId?: string; label: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Render only for principals holding admin.roles.manage as organisation owner. */
export function RolesManager({ canManage = true }: { canManage?: boolean }) {
  const [data, setData] = useState<RolesData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [roleKey, setRoleKey] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadErr(null);
    const r = await identityApi<RolesData>("/api/v1/identity/roles");
    if (!r.ok) {
      if (redirectForStatus(r.status, r.error)) return;
      return setLoadErr(r.error);
    }
    setData(r.data);
  }, []);
  useEffect(() => { if (canManage) void load(); }, [load, canManage]);

  if (!canManage) return <Alert tone="info">Role management is limited to the organisation owner.</Alert>;

  const needsVendor = roleKey === "VENDOR_OWNER" || roleKey === "VENDOR_STAFF";

  function stageAssign(e: FormEvent, m: Member) {
    e.preventDefault(); setError(null);
    if (!roleKey) return setError("Choose a role.");
    if (needsVendor && !UUID.test(vendorId.trim())) return setError("Vendor roles need a valid vendor ID (UUID).");
    setPending({ method: "POST", userId: m.userId, roleKey, vendorId: needsVendor ? vendorId.trim() : undefined, label: `Grant ${roleLabel(roleKey)} to ${m.name || m.email}` });
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!pending) return;
    if (!password) return setError("Enter your password.");
    if (!/^\d{6}$/.test(code)) return setError("Enter your 6-digit authenticator code.");
    setBusy(true); setError(null); setOk(null);
    const r = await identityApi<unknown>("/api/v1/identity/roles", pending.method, {
      userId: pending.userId, roleKey: pending.roleKey, ...(pending.vendorId ? { vendorId: pending.vendorId } : {}), password, code,
    });
    setBusy(false); setPassword(""); setCode("");
    if (!r.ok) { if (r.status !== 403 && redirectForStatus(r.status, r.error)) return; return setError(r.error); }
    setOk(pending.method === "POST"
      ? (pending.vendorId ? "Vendor role recorded. It stays pending until vendor approval." : "Role granted.")
      : "Role removed.");
    setPending(null); setAssignFor(null); setRoleKey(""); setVendorId("");
    void load();
  }

  const members = (data?.members ?? []).filter((m) => `${m.name} ${m.email}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <section className="panel" aria-labelledby="rm-title">
      <div className="id-row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div><h3 id="rm-title">Roles and access</h3><p className="sub" style={{ margin: 0 }}>Admin roles require the member to have an authenticator enrolled. Changes need your password and code.</p></div>
        <input className="id-input" style={{ maxWidth: 240 }} placeholder="Filter members" aria-label="Filter members" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div aria-live="polite" style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        {error && <Alert tone="error">{error}</Alert>}
        {ok && <Alert tone="success">{ok}</Alert>}
      </div>
      {pending && (
        <form className="reauth" onSubmit={confirm} noValidate style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: 14 }}>{pending.label}</strong>
          <Field label="Your password" type="password" autoComplete="current-password" value={password} onChange={setPassword} required autoFocus maxLength={128} />
          <Field label="Authenticator code" code inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} required />
          <div className="id-row end">
            <button type="button" className="btn ghost small" onClick={() => { setPending(null); setError(null); }}>Cancel</button>
            <Submit busy={busy} className={`btn small${pending.method === "DELETE" ? " danger" : ""}`} label="Applying">{pending.method === "DELETE" ? "Remove role" : "Grant role"}</Submit>
          </div>
        </form>
      )}
      {loadErr ? (
        <div className="err" role="alert"><span>{loadErr}</span><button type="button" className="btn small" onClick={load}>Retry</button></div>
      ) : !data ? (
        <div aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="sk" style={{ height: 32 }} />)}</div>
      ) : members.length === 0 ? (
        <div className="empty">{filter ? "No members match that filter." : "No members in this organisation yet."}</div>
      ) : (
        <table className="rm-table">
          <thead><tr><th>Member</th><th>Roles</th><th style={{ textAlign: "right" }}>Actions</th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId}>
                <td><b>{m.name || "Unnamed"}</b><br /><small style={{ color: "var(--muted)", fontFamily: "var(--mono)" }}>{m.email}</small></td>
                <td>
                  <div className="rm-roles">
                    {m.roles.length === 0 && <span className="pill warn">None</span>}
                    {m.roles.map((r) => (
                      <span key={r.id} className="rm-role">
                        <span className={`pill ${r.approved ? "plan" : "warn"}`} title={r.vendorId ? `Vendor ${r.vendorId}` : undefined}>{roleLabel(r.roleKey)}{!r.approved && " (pending)"}</span>
                        <button type="button" aria-label={`Remove ${roleLabel(r.roleKey)} from ${m.email}`} onClick={() => { setError(null); setPending({ method: "DELETE", userId: m.userId, roleKey: r.roleKey, vendorId: r.vendorId ?? undefined, label: `Remove ${roleLabel(r.roleKey)} from ${m.name || m.email}` }); }}>Remove</button>
                      </span>
                    ))}
                  </div>
                  {assignFor === m.userId && (
                    <form className="reauth" onSubmit={(e) => stageAssign(e, m)} noValidate>
                      <div className="id-field">
                        <label htmlFor={`rk-${m.userId}`}>Role</label>
                        <select id={`rk-${m.userId}`} className="id-input id-select" value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
                          <option value="">Choose a role</option>
                          {data.roleKeys.map((k) => <option key={k} value={k}>{roleLabel(k)}</option>)}
                        </select>
                      </div>
                      {needsVendor && <Field label="Vendor ID" value={vendorId} onChange={setVendorId} hint="Vendor grants stay pending until approval." />}
                      <div className="id-row end">
                        <button type="button" className="btn ghost small" onClick={() => setAssignFor(null)}>Cancel</button>
                        <button type="submit" className="btn small">Continue</button>
                      </div>
                    </form>
                  )}
                </td>
                <td style={{ textAlign: "right" }}>
                  {assignFor !== m.userId && <button type="button" className="btn ghost small" onClick={() => { setAssignFor(m.userId); setRoleKey(""); setVendorId(""); setError(null); }}>Add role</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
