"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import "./vendors.css";

type AnyRecord = Record<string, unknown>;
type Address = { addressLine1: string; addressLine2: string; city: string; region: string; postalCode: string; countryCode: string };
type Profile = {
  legalName: string; storeName: string; entityType: string; registeredAddress: Address;
  operationalAddress: Address | null; contactEmail: string; contactPhone: string;
  taxIdentifiers: { kind: string; value: string }[]; businessIdentifiers: { kind: string; value: string }[];
  contactPersonName: string; description: string; supportEmail: string; supportPhone: string;
  shippingOrigins: { label: string; address: Address }[];
};
type RuleSet = { requiredFields: string[]; requiredDocumentCategories: string[]; maxDocumentBytes: number; allowedMediaTypes: string[]; preventSelfReview: boolean };
type ApiResult<T = AnyRecord> = { data: T; response: Response };

const emptyAddress = (): Address => ({ addressLine1: "", addressLine2: "", city: "", region: "", postalCode: "", countryCode: "IN" });
const blankProfile = (): Profile => ({
  legalName: "", storeName: "", entityType: "COMPANY", registeredAddress: emptyAddress(), operationalAddress: null,
  contactEmail: "", contactPhone: "", taxIdentifiers: [], businessIdentifiers: [], contactPersonName: "",
  description: "", supportEmail: "", supportPhone: "", shippingOrigins: [],
});
const fieldNames: Record<string, string> = {
  legalName: "Legal name", storeName: "Store name", entityType: "Entity type", registeredAddress: "Registered address",
  operationalAddress: "Operational address", contactEmail: "Contact email", contactPhone: "Contact phone",
  taxIdentifiers: "Tax identifiers", businessIdentifiers: "Business identifiers", contactPersonName: "Contact person",
  description: "Business description", supportEmail: "Support email", supportPhone: "Support phone", shippingOrigins: "Shipping origins",
};
const applicationStatuses = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUIRED", "APPROVED", "REJECTED", "SUSPENDED"];
const fieldKeys = Object.keys(fieldNames);
const documentTypes = ["application/pdf", "image/png", "image/jpeg"];
const staffPermissionChoices = ["vendor.profile.manage", "vendor.catalogue.manage", "vendor.orders.manage", "vendor.application.view", "vendor.kyc.upload"];
const defaultRules: RuleSet = {
  requiredFields: ["legalName", "storeName", "entityType", "registeredAddress", "contactEmail"],
  requiredDocumentCategories: [], maxDocumentBytes: 5 * 1024 * 1024,
  allowedMediaTypes: documentTypes, preventSelfReview: true,
};

function messageFor(response: Response, body: unknown) {
  const payload = record(body);
  const issueMessages = asArray<unknown>(payload.issues)
    .map((issue) => record(issue).message)
    .filter((message): message is string => typeof message === "string");
  const candidate = payload.message ?? payload.error ?? payload.detail;
  const text = typeof candidate === "string" ? candidate : issueMessages.join(" ");
  if (response.status === 401) return text || "Your session has expired. Sign in again, then retry.";
  if (response.status === 403) return text || "You do not have permission to perform this action.";
  if (response.status === 428) return text || "Additional verification is required. Enter your password and current six-digit code.";
  if (response.status === 400 || response.status === 422) return text || "Some details are invalid. Review the highlighted fields and try again.";
  return text || `Request failed (${response.status}). Please try again.`;
}

async function api<T = AnyRecord>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  const response = await fetch(url, { ...init, credentials: "include", headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...init?.headers } });
  let data: AnyRecord = {};
  try { data = record(await response.json()); } catch { /* Private downloads use a separate path. */ }
  if (!response.ok) throw Object.assign(new Error(messageFor(response, data)), { status: response.status });
  return { data: data as T, response };
}
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const pick = (value: unknown, ...keys: string[]): unknown => {
  const object = record(value);
  return keys.map((key) => object[key]).find((item) => item !== undefined && item !== null);
};
const record = (value: unknown): AnyRecord => value && typeof value === "object" ? value as AnyRecord : {};
const asArray = <T = AnyRecord>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const fmtDate = (value: unknown) => value ? new Date(String(value)).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not submitted";
const statusClass = (value: unknown) => String(value || "draft").toLowerCase().replaceAll(" ", "_");
const titleCase = (value: unknown) => String(value || "Unknown").toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
const extractApplication = (body: unknown) => record(pick(body, "application", "vendorApplication", "data") ?? body);
const profileOf = (application: unknown): Profile => {
  const app = record(application);
  const profile = record(app.profile ?? record(app.vendor).profile);
  return {
    ...blankProfile(),
    ...profile,
    registeredAddress: { ...emptyAddress(), ...record(profile.registeredAddress) },
    operationalAddress: profile.operationalAddress ? { ...emptyAddress(), ...record(profile.operationalAddress) } : null,
    taxIdentifiers: asArray<Profile["taxIdentifiers"][number]>(profile.taxIdentifiers),
    businessIdentifiers: asArray<Profile["businessIdentifiers"][number]>(profile.businessIdentifiers),
    shippingOrigins: asArray<AnyRecord>(profile.shippingOrigins).map((origin) => ({
      ...origin,
      address: { ...emptyAddress(), ...record(origin.address) },
    })),
  } as Profile;
};
function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return <div className="v-note error" role="alert"><strong>Could not complete that request.</strong><div>{error}</div>{onRetry && <button type="button" className="v-btn small" style={{ marginTop: 9 }} onClick={onRetry}>Retry</button>}</div>;
}
function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" | "success" }) {
  return <div className={`v-note ${tone}`} role="status">{children}</div>;
}
function Status({ value }: { value: unknown }) { return <span className={`v-status ${statusClass(value)}`}>{titleCase(value)}</span>; }
function Field({ label, value, onChange, type = "text", hint, required, ...props }: {
  label: string; value: string; onChange: (value: string) => void; type?: string; hint?: string; required?: boolean;
  placeholder?: string; autoComplete?: string; inputMode?: "text" | "numeric" | "decimal" | "search" | "email" | "tel" | "url" | "none";
}) {
  return <label className="v-field"><span>{label}{required ? " *" : ""}</span><input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={required} {...props} />{hint && <small>{hint}</small>}</label>;
}
function AddressFields({ title, value, onChange, required = false }: { title: string; value: Address; onChange: (value: Address) => void; required?: boolean }) {
  const set = (key: keyof Address, next: string) => onChange({ ...value, [key]: key === "countryCode" ? next.toUpperCase().slice(0, 2) : next });
  return <fieldset className="v-address v-grid wide"><legend>{title}{required ? " *" : ""}</legend>
    <Field label="Address line 1" value={value.addressLine1} onChange={(v) => set("addressLine1", v)} required={required} />
    <Field label="Address line 2" value={value.addressLine2} onChange={(v) => set("addressLine2", v)} />
    <Field label="City" value={value.city} onChange={(v) => set("city", v)} required={required} />
    <Field label="State / region" value={value.region} onChange={(v) => set("region", v)} />
    <Field label="Postal code" value={value.postalCode} onChange={(v) => set("postalCode", v)} required={required} />
    <Field label="Country code" value={value.countryCode} onChange={(v) => set("countryCode", v)} required={required} hint="Two-letter code, for example IN." />
  </fieldset>;
}
function addressText(address: unknown) {
  const value = record(address);
  if (!address) return "Not provided";
  return [value.addressLine1, value.addressLine2, value.city, value.region, value.postalCode, value.countryCode].filter(Boolean).join(", ") || "Not provided";
}

export function VendorWorkspace({ vendorId: assignedVendorId, canApply = true, canManageBank = true, canManageStaff = true, canManageProfile = true }: {
  vendorId?: string; canApply?: boolean; canManageBank?: boolean; canManageStaff?: boolean; canManageProfile?: boolean;
}) {
  const [application, setApplication] = useState<AnyRecord | null>(null);
  const [profile, setProfile] = useState<Profile>(blankProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [documentCategory, setDocumentCategory] = useState("");
  const [uploading, setUploading] = useState(false);
  const [bank, setBank] = useState<AnyRecord | null>(null);
  const [staff, setStaff] = useState<AnyRecord[]>([]);
  const [bankForm, setBankForm] = useState({ accountHolderName: "", bankName: "", accountNumber: "", routingIdentifier: "", accountType: "CURRENT" });
  const [staffForm, setStaffForm] = useState({ email: "", phone: "", permissionKeys: [] as string[] });
  const [permissionDraft, setPermissionDraft] = useState<string[]>([]);
  const [reauth, setReauth] = useState<{ intent: string; password: string; code: string } | null>(null);
  const [inviteToken, setInviteToken] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteExpiresAt, setInviteExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const { data } = await api<AnyRecord>("/api/v1/vendor/applications");
      const app = extractApplication(data);
      setApplication(app && Object.keys(app).length ? app : null);
      setProfile(profileOf(app));
      setNotice("");
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const appId = String(pick(application, "id", "applicationId") || "");
  const appStatus = assignedVendorId && !application ? "APPROVED" : String(pick(application, "status") || "DRAFT");
  const vendorId = assignedVendorId || String(pick(application, "vendorId", "vendor_id") || "");
  const approved = Boolean(assignedVendorId) || (appStatus === "APPROVED" && Boolean(vendorId));

  const loadVendorTools = useCallback(async () => {
    if (!approved) return;
    try {
      const [bankResult, staffResult] = await Promise.all([
        canManageBank ? api<AnyRecord>("/api/v1/vendor/bank") : Promise.resolve(null),
        canManageStaff ? api<AnyRecord>(`/api/v1/vendor/staff?vendorId=${encodeURIComponent(vendorId)}`) : Promise.resolve(null),
      ]);
      setBank(asArray(bankResult?.data?.profiles).find((item) => item.vendorId === vendorId) ?? null);
      setStaff(asArray(pick(staffResult?.data, "staff", "memberships", "items", "data") ?? staffResult?.data));
    } catch (e) { setError((e as Error).message); }
  }, [approved, canManageBank, canManageStaff, vendorId]);
  useEffect(() => { void loadVendorTools(); }, [loadVendorTools]);
  const setProfileValue = <K extends keyof Profile,>(key: K, value: Profile[K]) =>
    setProfile((old) => ({ ...old, [key]: value }));

  async function saveProfile(event?: FormEvent) {
    event?.preventDefault(); setSaving(true); setError(""); setNotice("");
    try {
      const result = await api<AnyRecord>(appId ? `/api/v1/vendor/applications/${encodeURIComponent(appId)}` : "/api/v1/vendor/applications",
        json(appId ? "PATCH" : "POST", { profile }));
      const app = extractApplication(result.data);
      if (Object.keys(app).length) { setApplication(app); setProfile(profileOf(app)); }
      else if (!appId && result.data?.id) setApplication({ ...result.data, profile });
      setNotice("Your details were saved.");
      if (!appId) await load();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }
  async function submitApplication() {
    if (!appId) { setError("Save your application details before submitting."); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      const { data } = await api<AnyRecord>(`/api/v1/vendor/applications/${encodeURIComponent(appId)}/submit`, { method: "POST" });
      if (Object.keys(extractApplication(data)).length) setApplication(extractApplication(data));
      setNotice("Application submitted. The status will update when an administrator reviews it.");
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }
  async function downloadDocument(id: string, name?: string) {
    setError("");
    try {
      const response = await fetch(`/api/v1/vendor/documents/${encodeURIComponent(id)}`, { credentials: "include" });
      if (!response.ok) {
        let body: AnyRecord = {}; try { body = record(await response.json()); } catch {}
        throw new Error(messageFor(response, body));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = name || "private-document"; link.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError((e as Error).message); }
  }
  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = (form.elements.namedItem("documentFile") as HTMLInputElement)?.files?.[0];
    if (!appId || !file || !documentCategory.trim()) { setError("Choose a category and file, and save the application first."); return; }
    setUploading(true); setError(""); setNotice("");
    try {
      const body = new FormData(); body.append("applicationId", appId); body.append("category", documentCategory); body.append("file", file);
      await api("/api/v1/vendor/documents", { method: "POST", body });
      form.reset(); setNotice("Private document uploaded."); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setUploading(false); }
  }
  const startReauth = (intent: string) => { setError(""); setReauth({ intent, password: "", code: "" }); };
  async function runBankSave() {
    if (!reauth) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api("/api/v1/vendor/bank", json("POST", { vendorId, profile: bankForm, password: reauth.password, ...(reauth.code ? { code: reauth.code } : {}) }));
      setBankForm({ accountHolderName: "", bankName: "", accountNumber: "", routingIdentifier: "", accountType: "CURRENT" });
      setReauth(null); setNotice("Bank profile submitted for verification."); await loadVendorTools();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function runStaffInvite() {
    if (!reauth) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { data } = await api<AnyRecord>("/api/v1/vendor/staff", json("POST", {
        vendorId, ...(staffForm.email ? { email: staffForm.email } : {}), ...(staffForm.phone ? { phone: staffForm.phone } : {}),
        permissionKeys: staffForm.permissionKeys, password: reauth.password, ...(reauth.code ? { code: reauth.code } : {}),
      }));
      const invitation = record(data.invitation);
      setInviteLink(String(invitation.link || ""));
      setInviteExpiresAt(String(invitation.expiresAt || ""));
      setStaffForm({ email: "", phone: "", permissionKeys: [] }); setReauth(null); setNotice(String(data.delivery || "Staff invitation created.")); await loadVendorTools();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function acceptInvite() {
    setBusy(true); setError(""); setNotice("");
    try {
      await api("/api/v1/vendor/staff", json("PUT", { token: inviteToken }));
      setInviteToken(""); setNotice("Invitation accepted."); await loadVendorTools();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function staffAction(member: AnyRecord, action: "remove" | "permissions") {
    if (!reauth) return;
    const id = String(pick(member, "membershipId", "id", "membership_id") || "");
    setBusy(true); setError(""); setNotice("");
    try {
      if (action === "remove") await api(`/api/v1/vendor/staff/${encodeURIComponent(id)}`, json("DELETE", { vendorId, password: reauth.password, ...(reauth.code ? { code: reauth.code } : {}) }));
      else await api(`/api/v1/vendor/staff/${encodeURIComponent(id)}/permissions`, json("PATCH", { vendorId, permissionKeys: permissionDraft, password: reauth.password, ...(reauth.code ? { code: reauth.code } : {}) }));
      setReauth(null); setNotice(action === "remove" ? "Staff access revoked." : "Staff permissions updated."); await loadVendorTools();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const docs = asArray(pick(application, "documents", "privateDocuments")).filter((doc) => doc.active !== false);
  const history = asArray(pick(application, "messages", "history", "events", "timeline")).filter((event) => {
    return Boolean(pick(event, "vendorMessage", "messageToVendor")) || ["VENDOR", "VENDOR_VISIBLE"].includes(String(pick(event, "visibility", "audience") || "").toUpperCase());
  });
  const requirementStatus = useMemo(() => {
    const required = asArray<unknown>(pick(application, "requiredDocumentCategories", "requiredDocuments"));
    const done = new Set(docs.map((doc) => String(pick(doc, "category", "type") || "")));
    return required.map((cat) => ({ name: typeof cat === "string" ? cat : String(pick(cat, "category", "name") || "Required document"), done: done.has(typeof cat === "string" ? cat : String(pick(cat, "category", "name") || "")) }));
  }, [application, docs]);
  const lastFour = String(pick(bank, "lastFour", "accountLast4", "maskedLastFour") || (pick(bank, "accountNumber") ? String(bank?.accountNumber).slice(-4) : ""));
  const bankStatus = pick(bank, "status", "verificationStatus") || "Not added";

  if (loading) return <section className="vw" aria-label="Vendor workspace"><div className="v-head"><div><span className="v-eyebrow">Seller workspace</span><h2>Vendor onboarding</h2></div></div><div className="v-skeleton" aria-label="Loading vendor application" /></section>;
  return <section className="vw" aria-label="Vendor workspace">
    <header className="v-head">
      <div><span className="v-eyebrow">Euro Infotech · seller workspace</span><h2>{approved ? "Vendor profile" : "Vendor onboarding"}</h2>
        <p>{approved ? "Maintain your organisation details and tightly scoped team access." : "Share accurate company details and private records for a careful review."}</p></div>
      <Status value={appStatus} />
    </header>
    {error && <ErrorBox error={error} onRetry={load} />}
    {notice && <Notice tone="success">{notice}</Notice>}
    {inviteLink && <div className="v-note info"><strong>One-time staff invitation link</strong><p>Share this only with the invited person. It expires {fmtDate(inviteExpiresAt)} and can be used once.</p><input aria-label="One-time staff invitation link" readOnly value={inviteLink} onFocus={(event) => event.currentTarget.select()} /></div>}
    {!application && <Notice tone="warn">No application exists yet. Start with your legal and store identity, then save a draft before uploading private documents.</Notice>}
    {application && <div className="v-metrics"><span>Application reference</span><b>{String(pick(application, "id", "applicationId") || "Pending")}</b><span>Submitted</span><b>{fmtDate(pick(application, "submittedAt", "submitted_at"))}</b></div>}

    <div className="v-layout">
      <div className="v-main">
        {(application || canApply) && <form className="v-panel" onSubmit={saveProfile}>
          <div className="v-panel-head"><div><h3>Company details</h3><p>Use the registered entity information shown on your official records.</p></div>
            {application && <span className="v-tag">ID {appId}</span>}</div>
          {["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"].includes(appStatus) && <Notice tone="warn">This application is {titleCase(appStatus).toLowerCase()}. Editing is subject to server-side review rules; changes are never assumed saved.</Notice>}
          {approved && <div className="v-grid">
            <Field label="Store / trading name" value={profile.storeName} onChange={(v) => setProfileValue("storeName", v)} required />
            <AddressFields title="Operational address" value={profile.operationalAddress ?? emptyAddress()} onChange={(v) => setProfileValue("operationalAddress", v)} />
            <Field label="Support email" value={profile.supportEmail} onChange={(v) => setProfileValue("supportEmail", v)} type="email" />
            <Field label="Support phone" value={profile.supportPhone} onChange={(v) => setProfileValue("supportPhone", v)} type="tel" />
            <label className="v-field wide"><span>Store description</span><textarea maxLength={2000} value={profile.description} onChange={(e) => setProfileValue("description", e.target.value)} /><small>{profile.description.length}/2000 characters</small></label>
            <ShippingEditor values={profile.shippingOrigins} onChange={(v) => setProfileValue("shippingOrigins", v)} />
            {!canManageProfile && <div className="wide"><Notice tone="warn">Your vendor role can view this profile but cannot edit it.</Notice></div>}
          </div>}
          <div className="v-grid" hidden={approved}>
            <Field label="Legal company name" value={profile.legalName} onChange={(v) => setProfileValue("legalName", v)} required autoComplete="organization" />
            <Field label="Store / trading name" value={profile.storeName} onChange={(v) => setProfileValue("storeName", v)} required />
            <label className="v-field"><span>Entity type *</span><select value={profile.entityType} onChange={(e) => setProfileValue("entityType", e.target.value)}>
              {["INDIVIDUAL", "SOLE_PROPRIETORSHIP", "PARTNERSHIP", "COMPANY", "OTHER"].map((type) => <option value={type} key={type}>{titleCase(type)}</option>)}
            </select></label>
            <Field label="Contact person" value={profile.contactPersonName} onChange={(v) => setProfileValue("contactPersonName", v)} autoComplete="name" />
            <Field label="Business contact email" value={profile.contactEmail} onChange={(v) => setProfileValue("contactEmail", v)} type="email" required autoComplete="email" />
            <Field label="Business contact phone" value={profile.contactPhone} onChange={(v) => setProfileValue("contactPhone", v)} type="tel" autoComplete="tel" />
            <AddressFields title="Registered address" value={profile.registeredAddress} onChange={(v) => setProfileValue("registeredAddress", v)} required />
            <div className="v-field wide">
              <label className="v-check"><input type="checkbox" checked={Boolean(profile.operationalAddress)} onChange={(e) => setProfileValue("operationalAddress", e.target.checked ? emptyAddress() : null)} /> Operational address differs from registered address</label>
            </div>
            {profile.operationalAddress && <AddressFields title="Operational address" value={profile.operationalAddress} onChange={(v) => setProfileValue("operationalAddress", v)} />}
            <IdentifierEditor title="Tax identifiers" values={profile.taxIdentifiers} onChange={(v) => setProfileValue("taxIdentifiers", v)} />
            <IdentifierEditor title="Business identifiers" values={profile.businessIdentifiers} onChange={(v) => setProfileValue("businessIdentifiers", v)} />
            <Field label="Support email" value={profile.supportEmail} onChange={(v) => setProfileValue("supportEmail", v)} type="email" />
            <Field label="Support phone" value={profile.supportPhone} onChange={(v) => setProfileValue("supportPhone", v)} type="tel" />
            <label className="v-field wide"><span>Business description</span><textarea maxLength={2000} value={profile.description} onChange={(e) => setProfileValue("description", e.target.value)} placeholder="What do you make, source or provide?" /><small>{profile.description.length}/2000 characters</small></label>
            <ShippingEditor values={profile.shippingOrigins} onChange={(v) => setProfileValue("shippingOrigins", v)} />
          </div>
          <div className="v-button-row"><span className="v-doc-meta">Drafts remain private to your organisation.</span>
            <div className="v-actions">{(!approved && (["DRAFT", "CHANGES_REQUIRED"].includes(appStatus) || (!application && canApply))) && <button type="submit" formNoValidate className="v-btn" disabled={saving}>{saving ? "Saving…" : "Save draft"}</button>}
              {approved && canManageProfile && <button type="submit" formNoValidate className="v-btn" disabled={saving}>{saving ? "Saving…" : "Save store profile"}</button>}
              {!approved && ["DRAFT", "CHANGES_REQUIRED"].includes(appStatus) && <button type="button" className="v-btn primary" disabled={saving || !appId} onClick={submitApplication}>{saving ? "Working…" : "Submit for review"}</button>}</div>
          </div>
        </form>}

        {application && <section className="v-panel">
          <div className="v-panel-head"><div><h3>Private documents</h3><p>Files are stored privately and downloaded through your authenticated session.</p></div></div>
          <form onSubmit={uploadDocument} className="v-grid">
            <Field label="Document category" value={documentCategory} onChange={setDocumentCategory} placeholder="For example, gst-certificate" required />
            <label className="v-field"><span>Select file *</span><input name="documentFile" type="file" accept={documentTypes.join(",")} required /><small>PDF, PNG or JPEG. File and size limits are enforced by the server.</small></label>
            <div className="v-actions wide"><button type="submit" className="v-btn primary" disabled={uploading || !appId}>{uploading ? "Uploading…" : "Upload private document"}</button>
              {!appId && <small>Save the application first to attach documents.</small>}</div>
          </form>
          <div className="v-list" style={{ marginTop: 15 }}>
            {docs.length ? docs.map((doc, index) => {
              const id = String(pick(doc, "id", "documentId") || "");
              return <div className="v-list-row" key={id || index}><div><strong>{String(pick(doc, "originalFilename", "name", "fileName", "originalName") || "Private document")}</strong>
                <small>{String(pick(doc, "category", "type") || "Uncategorised")} · {String(pick(doc, "mediaType", "mimeType", "contentType") || "File")} · {formatBytes(pick(doc, "sizeBytes", "size") || 0)}</small></div>
                <button type="button" className="v-btn small" onClick={() => void downloadDocument(id, String(pick(doc, "originalFilename", "name", "fileName") || "private-document"))} disabled={!id}>Authenticated download</button></div>;
            }) : <div className="v-empty"><strong>No private documents yet</strong><p>Upload the requested company evidence here. Only document metadata is shown in this list.</p></div>}
          </div>
        </section>}
        {application && <section className="v-panel"><div className="v-panel-head"><div><h3>Application updates</h3><p>Only messages intended for you appear here.</p></div></div>
          {history.length ? <div className="v-timeline">{history.map((event, index) => <div className="v-event" key={String(pick(event, "id") || index)}>
            <strong>{pick(event, "action", "title") ? titleCase(pick(event, "action", "title")) : "Review update"}</strong>
            <p>{String(pick(event, "vendorMessage", "messageToVendor", "message") || "")}</p><time>{fmtDate(pick(event, "createdAt", "created_at", "at"))}</time>
          </div>)}</div> : <div className="v-empty"><strong>No updates yet</strong><p>Administrator messages will appear here after your application is reviewed.</p></div>}</section>}
      </div>

      <aside className="v-side" aria-label="Application guidance">
        <section className="v-panel"><span className="v-eyebrow">Review status</span><h3 style={{ marginTop: 8 }}>{titleCase(appStatus)}</h3>
          <p>{statusCopy(appStatus)}</p><div className="v-metrics"><span>Submitted on</span><b>{pick(application, "submittedAt", "submitted_at") ? fmtDate(pick(application, "submittedAt", "submitted_at")) : "—"}</b></div>
          <div className="v-metrics"><span>Documents attached</span><b>{docs.length}</b></div></section>
        {application && <section className="v-panel"><h3>What to prepare</h3><p>Use exact legal names and current company records.</p>
          <ul className="v-requirements">{requirementStatus.length ? requirementStatus.map((item) => <li key={item.name}>{item.name} — {item.done ? "received" : "still needed"}</li>) :
            <><li>Legal and trading names should match your records.</li><li>Provide a complete registered business address.</li><li>Upload only requested, legible documents.</li></>}</ul></section>}
        {approved && <>{canManageBank && <section className="v-panel"><div className="v-panel-head"><div><span className="v-eyebrow">Bank details</span><h3 style={{ marginTop: 6 }}>Bank profile</h3></div><Status value={bankStatus} /></div>
          <p>Account details are never shown here. Only the last four digits and verification state are visible.</p>
          {bank && <div className="v-metrics"><span>Account ending</span><b>{lastFour ? `•••• ${lastFour}` : "••••"}</b></div>}
          <button type="button" className="v-btn" onClick={() => startReauth("bank")}>{bank ? "Update bank profile" : "Add bank profile"}</button></section>}
          {canManageStaff && <section className="v-panel"><div className="v-panel-head"><div><span className="v-eyebrow">Access control</span><h3 style={{ marginTop: 6 }}>Staff</h3></div><span className="v-tag">{staff.length} member{staff.length === 1 ? "" : "s"}</span></div>
            <p>Invite team members with only the permission keys they need.</p>
            <button type="button" className="v-btn" onClick={() => startReauth("staff-invite")}>Invite staff member</button>
            {staff.length > 0 && <div className="v-list" style={{ marginTop: 12 }}>{staff.map((member, i) => <div className="v-list-row" key={String(pick(member, "membershipId", "id") || i)}>
              <div><strong>{String(pick(member, "name", "displayName") || "Invited member")}</strong><small>{String(pick(member, "email", "phone") || "Contact not available")}</small>
                <div className="v-perms" style={{ marginTop: 7 }}>{asArray<string>(member.permissionKeys).map((key) => <span className="v-tag" key={key}>{key}</span>)}</div></div>
              <div className="v-actions"><button type="button" className="v-btn small" onClick={() => { setPermissionDraft(asArray<string>(member.permissionKeys).filter((key) => key === "vendor.bank.manage")); setReauth({ intent: `permissions:${i}`, password: "", code: "" }); }}>Bank access</button>
                <button type="button" className="v-btn danger small" onClick={() => { setReauth({ intent: `remove:${i}`, password: "", code: "" }); }}>Revoke</button></div>
            </div>)}</div>}
            <div className="v-field" style={{ marginTop: 14 }}><label>Accept an invitation token</label><input value={inviteToken} onChange={(e) => setInviteToken(e.target.value)} placeholder="Paste private invitation token" /></div>
            <button type="button" className="v-btn small" style={{ marginTop: 8 }} disabled={!inviteToken || busy} onClick={() => void acceptInvite()}>{busy ? "Working…" : "Accept invitation"}</button>
           </section>}
        </>}
      </aside>
    </div>

    {reauth && <div className="v-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setReauth(null); }}>
      <section className="v-dialog" role="dialog" aria-modal="true" aria-labelledby="vendor-reauth-heading">
        <h3 id="vendor-reauth-heading">{reauth.intent === "bank" ? "Confirm bank profile change" : reauth.intent === "staff-invite" ? "Confirm staff invitation" : "Confirm staff access change"}</h3>
        <p>This sensitive change requires your password and, when enabled for your session, your current authenticator code. The API remains authoritative.</p>
        {error && <ErrorBox error={error} />}
        {reauth.intent === "bank" && <div className="v-grid">
          <Field label="Account holder name" value={bankForm.accountHolderName} onChange={(v) => setBankForm({ ...bankForm, accountHolderName: v })} required />
          <Field label="Bank name" value={bankForm.bankName} onChange={(v) => setBankForm({ ...bankForm, bankName: v })} required />
          <Field label="Account number" value={bankForm.accountNumber} onChange={(v) => setBankForm({ ...bankForm, accountNumber: v })} required autoComplete="off" inputMode="numeric" />
          <Field label="Routing identifier" value={bankForm.routingIdentifier} onChange={(v) => setBankForm({ ...bankForm, routingIdentifier: v })} required hint="IFSC or applicable routing code." />
          <label className="v-field"><span>Account type</span><select value={bankForm.accountType} onChange={(e) => setBankForm({ ...bankForm, accountType: e.target.value })}><option value="CURRENT">Current</option><option value="SAVINGS">Savings</option><option value="OTHER">Other</option></select></label>
        </div>}
        {reauth.intent === "staff-invite" && <div className="v-grid">
          <Field label="Email address" value={staffForm.email} onChange={(v) => setStaffForm({ ...staffForm, email: v })} type="email" />
          <Field label="Phone number" value={staffForm.phone} onChange={(v) => setStaffForm({ ...staffForm, phone: v })} type="tel" hint="International format, for example +919876543210." />
          <fieldset className="v-address wide"><legend>Granted permissions</legend><div className="v-checks">{staffPermissionChoices.map((permission) => <label className="v-check" key={permission}>
            <input type="checkbox" checked={staffForm.permissionKeys.includes(permission)} onChange={(e) => setStaffForm((old) => ({ ...old, permissionKeys: e.target.checked ? [...old.permissionKeys, permission] : old.permissionKeys.filter((key) => key !== permission) }))} />{permission}</label>)}</div></fieldset>
        </div>}
        {reauth.intent.startsWith("permissions:") && <fieldset className="v-address"><legend>Explicit permission key</legend>
          <label className="v-check"><input type="checkbox" checked={permissionDraft.includes("vendor.bank.manage")} onChange={(e) => setPermissionDraft(e.target.checked ? ["vendor.bank.manage"] : [])} />vendor.bank.manage</label>
          <small>Only this key can be managed through the staff-permissions endpoint.</small>
        </fieldset>}
        {reauth.intent.startsWith("remove:") && <p>Revoking access is immediate when accepted by the server. This action cannot be undone here.</p>}
        <div className="v-field" style={{ marginTop: 13 }}><label htmlFor="vendor-sensitive-password">Password</label><input id="vendor-sensitive-password" type="password" autoComplete="current-password" value={reauth.password} onChange={(e) => setReauth({ ...reauth, password: e.target.value })} required /></div>
        <div className="v-field"><label htmlFor="vendor-sensitive-code">Authenticator code (if prompted)</label><input id="vendor-sensitive-code" inputMode="numeric" maxLength={6} value={reauth.code} onChange={(e) => setReauth({ ...reauth, code: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="6 digits" /></div>
        <div className="v-actions" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="v-btn" disabled={busy} onClick={() => setReauth(null)}>Cancel</button>
          <button type="button" className="v-btn primary" disabled={busy || !reauth.password} onClick={() => {
            if (reauth.intent === "bank") void runBankSave();
            else if (reauth.intent === "staff-invite") void runStaffInvite();
            else if (reauth.intent.startsWith("permissions:")) { const index = Number(reauth.intent.split(":")[1]); const member = staff[index]; if (member) void staffAction(member, "permissions"); }
            else { const index = Number(reauth.intent.split(":")[1]); const member = staff[index]; if (member) void staffAction(member, "remove"); }
          }}>{busy ? "Confirming…" : "Confirm securely"}</button>
        </div>
      </section>
    </div>}
  </section>;
}

function IdentifierEditor({ title, values, onChange }: { title: string; values: { kind: string; value: string }[]; onChange: (values: { kind: string; value: string }[]) => void }) {
  return <section className="v-field"><span>{title}</span>{values.map((item, index) => <div key={index} style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr auto", gap: 5 }}>
    <input aria-label={`${title} type ${index + 1}`} value={item.kind} onChange={(e) => onChange(values.map((v, i) => i === index ? { ...v, kind: e.target.value } : v))} placeholder="Type (GSTIN)" />
    <input aria-label={`${title} value ${index + 1}`} value={item.value} onChange={(e) => onChange(values.map((v, i) => i === index ? { ...v, value: e.target.value } : v))} placeholder="Identifier" />
    <button type="button" className="v-btn small danger" aria-label={`Remove ${title} ${index + 1}`} onClick={() => onChange(values.filter((_, i) => i !== index))}>Remove</button>
  </div>)}<button type="button" className="v-btn small" style={{ justifySelf: "start" }} onClick={() => onChange([...values, { kind: "", value: "" }])}>Add identifier</button></section>;
}
function ShippingEditor({ values, onChange }: { values: Profile["shippingOrigins"]; onChange: (values: Profile["shippingOrigins"]) => void }) {
  return <section className="v-field wide"><span>Shipping origins</span><p style={{ margin: 0, fontSize: 11, color: "var(--v-muted)" }}>Locations from which orders will be dispatched.</p>
    {values.map((origin, index) => <fieldset className="v-address v-grid" key={index}><legend>Origin {index + 1}</legend>
      <Field label="Origin label" value={origin.label} onChange={(v) => onChange(values.map((o, i) => i === index ? { ...o, label: v } : o))} />
      <button type="button" className="v-btn small danger" style={{ justifySelf: "start" }} onClick={() => onChange(values.filter((_, i) => i !== index))}>Remove origin</button>
      <AddressFields title="Dispatch address" value={origin.address} onChange={(address) => onChange(values.map((o, i) => i === index ? { ...o, address } : o))} />
    </fieldset>)}
    <button type="button" className="v-btn small" style={{ justifySelf: "start" }} onClick={() => onChange([...values, { label: "", address: emptyAddress() }])}>Add shipping origin</button>
  </section>;
}
function formatBytes(value: unknown) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function statusCopy(status: string) {
  const copy: Record<string, string> = {
    DRAFT: "Your details are saved as a draft. Submit them when the required fields and records are ready.",
    SUBMITTED: "Your application is in the review queue. You can track vendor-facing messages below.",
    UNDER_REVIEW: "An administrator is reviewing the submitted information.",
    CHANGES_REQUIRED: "Please review the administrator’s vendor-facing message and update the requested details.",
    APPROVED: "Your vendor identity is approved. Keep your organisation profile current.",
    REJECTED: "This application was not approved. Contact your organisation administrator for guidance.",
    SUSPENDED: "Vendor access is suspended. Review the latest vendor-facing message for next steps.",
  };
  return copy[status] || "Application status is available from the review service.";
}

export function AdminWorkspace({ canReview = false, canApprove = false, canSuspend = false, canVerifyBank = false, canConfigure = false }: {
  canReview?: boolean; canApprove?: boolean; canSuspend?: boolean; canVerifyBank?: boolean; canConfigure?: boolean;
}) {
  const [statusFilter, setStatusFilter] = useState("SUBMITTED");
  const [applications, setApplications] = useState<AnyRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<AnyRecord | null>(null);
  const [rules, setRules] = useState<RuleSet>(defaultRules);
  const [categoriesInput, setCategoriesInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savingRules, setSavingRules] = useState(false);
  const [decision, setDecision] = useState({ action: "start-review", internalReason: "", vendorMessage: "", password: "", code: "" });
  const [bankDecision, setBankDecision] = useState({ status: "VERIFIED" as "VERIFIED" | "REJECTED", reason: "", password: "", code: "" });
  const [ruleAuth, setRuleAuth] = useState({ password: "", code: "" });
  const [busyDecision, setBusyDecision] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const { data } = await api<AnyRecord>(`/api/v1/admin/vendors?status=${encodeURIComponent(statusFilter)}`);
      const items = asArray(pick(data, "applications", "vendors", "items", "results", "data") ?? data);
      setApplications(items);
      if (selectedId && !items.some((item) => String(pick(item, "id", "applicationId")) === selectedId)) setSelectedId("");
      if (!selectedId && items.length) setSelectedId(String(pick(items[0], "id", "applicationId") || ""));
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [statusFilter, selectedId]);
  useEffect(() => { void loadList(); }, [loadList]);
  const loadDetail = useCallback(async (id: string) => {
    if (!id) { setDetail(null); return; }
    setDetailLoading(true); setError("");
    try {
      const { data } = await api<AnyRecord>(`/api/v1/admin/vendors/${encodeURIComponent(id)}`);
      setDetail({ ...record(data), ...record(pick(data, "application", "vendor", "data") ?? data) });
    } catch (e) { setError((e as Error).message); setDetail(null); }
    finally { setDetailLoading(false); }
  }, []);
  useEffect(() => { void loadDetail(selectedId); }, [selectedId, loadDetail]);
  const loadRules = useCallback(async () => {
    if (!canConfigure) return;
    try {
      const { data } = await api<AnyRecord>("/api/v1/admin/vendors/rules");
      const loaded = record(pick(data, "rules", "data") ?? data);
      setRules({ ...defaultRules, ...loaded });
      setCategoriesInput(asArray(loaded.requiredDocumentCategories).join(", "));
    } catch (e) { setError((e as Error).message); }
  }, [canConfigure]);
  useEffect(() => { void loadRules(); }, [loadRules]);
  const app = detail;
  const appProfile = profileOf(app);
  const docList = asArray(pick(app, "documents", "privateDocuments"));
  const adminHistory = asArray(pick(app, "decisions", "history", "events", "timeline"));
  const adminBankProfile = app?.bankProfile ? record(app.bankProfile) : null;
  const selectedStatus = String(pick(app, "status") || "");

  async function downloadAdminDocument(id: string, name?: string) {
    setError("");
    try {
      const response = await fetch(`/api/v1/vendor/documents/${encodeURIComponent(id)}`, { credentials: "include" });
      if (!response.ok) { let body: AnyRecord = {}; try { body = record(await response.json()); } catch {} throw new Error(messageFor(response, body)); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = name || "private-document"; link.click(); URL.revokeObjectURL(url);
    } catch (e) { setError((e as Error).message); }
  }
  async function makeDecision(event: FormEvent) {
    event.preventDefault(); if (!selectedId) return;
    setBusyDecision(true); setError(""); setNotice("");
    try {
      await api(`/api/v1/admin/vendors/${encodeURIComponent(selectedId)}/decision`, json("POST", {
        action: decision.action, internalReason: decision.internalReason, vendorMessage: decision.vendorMessage,
        password: decision.password, ...(decision.code ? { code: decision.code } : {}),
      }));
      setNotice("Decision recorded by the review service.");
      setDecision({ action: "start-review", internalReason: "", vendorMessage: "", password: "", code: "" });
      await Promise.all([loadDetail(selectedId), loadList()]);
    } catch (e) { setError((e as Error).message); }
    finally { setBusyDecision(false); }
  }
  async function makeBankDecision(event: FormEvent) {
    event.preventDefault();
    const applicationId = String(pick(app, "id", "applicationId") || "");
    if (!applicationId) return;
    setError(""); setNotice(""); setBusyDecision(true);
    try {
      const { code, ...bankDecisionPayload } = bankDecision;
      await api(`/api/v1/admin/vendors/${encodeURIComponent(applicationId)}/bank-verification`, json("POST", {
        ...bankDecisionPayload, ...(code ? { code } : {}),
      }));
      setNotice(`Bank profile marked ${bankDecision.status.toLowerCase()}. No full account number was accessed.`);
      setBankDecision({ status: "VERIFIED", reason: "", password: "", code: "" });
      await loadDetail(applicationId);
    } catch (e) { setError((e as Error).message); }
    finally { setBusyDecision(false); }
  }
  async function saveRules(event: FormEvent) {
    event.preventDefault(); setSavingRules(true); setError(""); setNotice("");
    const updated = { ...rules, requiredDocumentCategories: categoriesInput.split(",").map((x) => x.trim()).filter(Boolean) };
    try {
      await api("/api/v1/admin/vendors/rules", json("PUT", { rules: updated, password: ruleAuth.password, ...(ruleAuth.code ? { code: ruleAuth.code } : {}) }));
      setRules(updated); setNotice("Onboarding requirements were saved by the rules service."); setRuleAuth({ password: "", code: "" });
      await loadRules();
    } catch (e) { setError((e as Error).message); }
    finally { setSavingRules(false); }
  }
  const patchRuleField = (key: string, checked: boolean) => setRules((old) => ({ ...old, requiredFields: checked ? [...old.requiredFields, key] : old.requiredFields.filter((x) => x !== key) }));

  return <section className="aw" aria-label="Vendor administration">
    <header className="v-head"><div><span className="v-eyebrow">Euro Infotech · organisation review</span><h2>Vendor applications</h2>
      <p>Review company evidence, record an auditable decision and keep vendor-facing guidance separate from internal notes.</p></div>
      <div className="v-actions"><label className="v-sr" htmlFor="admin-vendor-status">Filter applications</label><select id="admin-vendor-status" className="v-control" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
        <option value="SUBMITTED">Submitted</option>{applicationStatuses.filter((s) => s !== "SUBMITTED").map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}<option value="ALL">All statuses</option>
      </select><button type="button" className="v-btn" onClick={() => void loadList()} disabled={loading}>{loading ? "Refreshing…" : "Refresh queue"}</button></div>
    </header>
    {error && <ErrorBox error={error} onRetry={() => { void loadList(); if (selectedId) void loadDetail(selectedId); }} />}
    {notice && <Notice tone="success">{notice}</Notice>}
    {!canReview && <Notice tone="warn">You can view vendor records, but review decisions require the appropriate administrator permission.</Notice>}
    <div className="v-admin-layout">
      <section className="v-panel"><div className="v-panel-head"><div><h3>Review queue</h3><p>{applications.length} result{applications.length === 1 ? "" : "s"}</p></div></div>
        {loading ? <div className="v-skeleton" aria-label="Loading applications" /> : applications.length ? <div className="v-application-list">{applications.map((item, index) => {
          const id = String(pick(item, "id", "applicationId") || "");
          return <button type="button" className="v-app-item" key={id || index} aria-current={selectedId === id} onClick={() => setSelectedId(id)}>
            <b>{String(pick(item.profile, "storeName", "legalName") || pick(item.vendor, "storeName", "legalName") || pick(item, "storeName", "legalName") || "Vendor application")}</b>
            <small>{id} · {titleCase(pick(item, "status"))}</small><small>Submitted {fmtDate(pick(item, "submittedAt", "submitted_at"))}</small></button>;
        })}</div> : <div className="v-empty"><strong>Queue is clear</strong><p>No applications match this status. Choose another status or refresh.</p><button type="button" className="v-btn small" onClick={() => setStatusFilter("ALL")}>Show all statuses</button></div>}
      </section>
      <div className="v-main">
        {detailLoading ? <div className="v-skeleton" aria-label="Loading application detail" /> : app ? <>
          <section className="v-panel"><div className="v-panel-head"><div><span className="v-eyebrow">Application {String(pick(app, "id", "applicationId") || "")}</span><h3 style={{ marginTop: 6 }}>{appProfile.storeName || appProfile.legalName || "Vendor application"}</h3><p>Submitted {fmtDate(pick(app, "submittedAt", "submitted_at"))}</p></div><Status value={selectedStatus} /></div>
            <div className="v-detail-grid">
              <Detail label="Legal name" value={appProfile.legalName} /><Detail label="Store name" value={appProfile.storeName} />
              <Detail label="Entity type" value={titleCase(appProfile.entityType)} /><Detail label="Contact person" value={appProfile.contactPersonName} />
              <Detail label="Contact details" value={`${appProfile.contactEmail || "—"}${appProfile.contactPhone ? ` · ${appProfile.contactPhone}` : ""}`} />
              <Detail label="Support details" value={`${appProfile.supportEmail || "—"}${appProfile.supportPhone ? ` · ${appProfile.supportPhone}` : ""}`} />
              <Detail label="Registered address" value={addressText(appProfile.registeredAddress)} />
              <Detail label="Operational address" value={addressText(appProfile.operationalAddress)} />
              <Detail label="Tax identifiers" value={appProfile.taxIdentifiers.map((x) => `${x.kind}: ${x.value}`).join("\n") || "Not provided"} />
              <Detail label="Business identifiers" value={appProfile.businessIdentifiers.map((x) => `${x.kind}: ${x.value}`).join("\n") || "Not provided"} />
              <Detail label="Business description" value={appProfile.description || "Not provided"} />
              <Detail label="Shipping origins" value={appProfile.shippingOrigins.map((x) => `${x.label}: ${addressText(x.address)}`).join("\n") || "Not provided"} />
            </div>
          </section>
          <section className="v-panel"><div className="v-panel-head"><div><h3>Private evidence</h3><p>Downloads use the authenticated private-document route.</p></div><span className="v-tag">{docList.length} file{docList.length === 1 ? "" : "s"}</span></div>
            {docList.length ? <div className="v-list">{docList.map((doc, index) => { const id = String(pick(doc, "id", "documentId") || ""); return <div className="v-list-row" key={id || index}>
              <div><strong>{String(pick(doc, "originalFilename", "name", "fileName", "originalName") || "Private document")}</strong><small>{String(pick(doc, "category", "type") || "Uncategorised")} · {String(pick(doc, "mediaType", "mimeType", "contentType") || "File")} · {formatBytes(pick(doc, "sizeBytes", "size"))}</small></div>
              <button type="button" className="v-btn small" disabled={!id} onClick={() => void downloadAdminDocument(id, String(pick(doc, "originalFilename", "name", "fileName") || "private-document"))}>Download privately</button>
            </div>; })}</div> : <div className="v-empty"><strong>No documents attached</strong><p>The applicant has not uploaded private evidence.</p></div>}
          </section>
          {canVerifyBank && <form className="v-panel" onSubmit={makeBankDecision}>
            <div className="v-panel-head"><div><h3>Bank verification</h3><p>Only a masked account identifier is available to this review flow.</p></div>
               {adminBankProfile && <Status value={adminBankProfile.verificationStatus} />}</div>
             {adminBankProfile ? <>
               <div className="v-metrics"><span>Account ending</span><b>{String(adminBankProfile.accountNumber || "")}</b><span>Updated</span><b>{fmtDate(adminBankProfile.updatedAt)}</b></div>
              <div className="v-grid">
                <label className="v-field"><span>Verification result</span><select value={bankDecision.status} onChange={(e) => setBankDecision({ ...bankDecision, status: e.target.value as "VERIFIED" | "REJECTED" })}>
                  <option value="VERIFIED">Verify</option><option value="REJECTED">Reject</option>
                </select></label>
                <Field label="Internal reason (required)" value={bankDecision.reason} onChange={(v) => setBankDecision({ ...bankDecision, reason: v })} required />
                <Field label="Administrator password" value={bankDecision.password} onChange={(v) => setBankDecision({ ...bankDecision, password: v })} type="password" required autoComplete="current-password" />
                <Field label="Authenticator code (if prompted)" value={bankDecision.code} onChange={(v) => setBankDecision({ ...bankDecision, code: v.replace(/\D/g, "").slice(0, 6) })} inputMode="numeric" placeholder="6 digits" />
                <div className="v-actions wide" style={{ justifyContent: "flex-end" }}><button type="submit" className="v-btn primary" disabled={busyDecision || !bankDecision.password || bankDecision.reason.trim().length < 5}>{busyDecision ? "Recording…" : "Record bank decision"}</button></div>
              </div>
            </> : <div className="v-empty"><strong>No bank profile submitted</strong><p>There is no masked bank record available for this application.</p></div>}
          </form>}
          <section className="v-panel"><div className="v-panel-head"><div><h3>Audited history</h3><p>Internal reasons remain administrator-only; vendor messages are shown separately.</p></div></div>
             {adminHistory.length ? <div className="v-timeline">{adminHistory.map((event, index) => <div className="v-event" key={String(pick(event, "id") || index)}>
              <strong>{titleCase(pick(event, "action", "decision", "toStatus", "title") || "Application event")}</strong>
               {Boolean(pick(event, "internalReason", "reason")) && <p><b>Internal reason:</b> {String(pick(event, "internalReason", "reason"))}</p>}
               {Boolean(pick(event, "vendorMessage", "messageToVendor")) && <p><b>Vendor message:</b> {String(pick(event, "vendorMessage", "messageToVendor"))}</p>}
              <time>{fmtDate(pick(event, "createdAt", "created_at", "at"))}</time></div>)}</div> : <div className="v-empty"><strong>No recorded history</strong><p>Decision events will be listed here after the first review action.</p></div>}
          </section>
          <form className="v-panel" onSubmit={makeDecision}>
            <div className="v-panel-head"><div><span className="v-eyebrow">Audited decision</span><h3 style={{ marginTop: 6 }}>Record a review action</h3><p>Internal rationale is not shared with the applicant. Vendor message is optional and separate.</p></div></div>
            {!canReview ? <Notice tone="warn">Decision controls are disabled for your current administrator role.</Notice> : <div className="v-grid">
              <label className="v-field"><span>Action</span><select value={decision.action} onChange={(e) => setDecision({ ...decision, action: e.target.value })}>
                {[
                  ...(canReview ? ["start-review", "request-changes", "reject"] : []),
                  ...(canApprove ? ["approve"] : []),
                  ...(canSuspend ? ["suspend", "reactivate"] : []),
                ].map((action) => <option key={action} value={action}>{titleCase(action)}</option>)}
              </select></label>
              <Field label="Internal reason (required)" value={decision.internalReason} onChange={(v) => setDecision({ ...decision, internalReason: v })} required />
              <label className="v-field wide"><span>Vendor-facing message</span><textarea maxLength={1000} value={decision.vendorMessage} onChange={(e) => setDecision({ ...decision, vendorMessage: e.target.value })} placeholder="Clear next steps visible to the applicant only." /><small>{decision.vendorMessage.length}/1000 characters</small></label>
              <Field label="Administrator password" value={decision.password} onChange={(v) => setDecision({ ...decision, password: v })} type="password" required autoComplete="current-password" />
              <Field label="Authenticator code (if prompted)" value={decision.code} onChange={(v) => setDecision({ ...decision, code: v.replace(/\D/g, "").slice(0, 6) })} inputMode="numeric" placeholder="6 digits" />
              <div className="v-actions wide" style={{ justifyContent: "flex-end" }}><button type="submit" className="v-btn primary" disabled={busyDecision || !decision.password || decision.internalReason.trim().length < 5}>{busyDecision ? "Recording…" : "Record audited decision"}</button></div>
            </div>}
          </form>
        </> : <div className="v-empty"><strong>Select an application</strong><p>Choose a vendor from the review queue to inspect its details, documents and audited history.</p></div>}
      </div>
    </div>

    {canConfigure && <form className="v-panel" style={{ marginTop: 20 }} onSubmit={saveRules}>
      <div className="v-panel-head"><div><span className="v-eyebrow">Onboarding policy</span><h3 style={{ marginTop: 6 }}>Requirements configuration</h3><p>Saved changes apply through the rules API; local values are never treated as authoritative until confirmed.</p></div></div>
      <div className="v-rule-grid">
        <div className="v-field"><span>Required application fields</span><div className="v-checks">{fieldKeys.map((key) => <label className="v-check" key={key}><input type="checkbox" checked={rules.requiredFields.includes(key)} onChange={(e) => patchRuleField(key, e.target.checked)} />{fieldNames[key]}</label>)}</div></div>
        <div className="v-field"><label htmlFor="required-doc-categories">Required document categories</label><textarea id="required-doc-categories" value={categoriesInput} onChange={(e) => setCategoriesInput(e.target.value)} placeholder="gst-certificate, incorporation-proof" /><small>Comma-separated category keys, such as gst-certificate.</small></div>
        <Field label="Maximum document size (bytes)" type="number" value={String(rules.maxDocumentBytes)} onChange={(v) => setRules({ ...rules, maxDocumentBytes: Number(v) })} required />
        <fieldset className="v-address"><legend>Allowed document types</legend><div className="v-checks">{documentTypes.map((type) => <label className="v-check" key={type}><input type="checkbox" checked={rules.allowedMediaTypes.includes(type)} onChange={(e) => setRules({ ...rules, allowedMediaTypes: e.target.checked ? [...rules.allowedMediaTypes, type] : rules.allowedMediaTypes.filter((x) => x !== type) })} />{type}</label>)}</div></fieldset>
        <label className="v-check"><input type="checkbox" checked={rules.preventSelfReview} onChange={(e) => setRules({ ...rules, preventSelfReview: e.target.checked })} />Prevent reviewers from reviewing their own applications</label>
        <Field label="Administrator password" value={ruleAuth.password} onChange={(v) => setRuleAuth({ ...ruleAuth, password: v })} type="password" required autoComplete="current-password" />
        <Field label="Authenticator code (if prompted)" value={ruleAuth.code} onChange={(v) => setRuleAuth({ ...ruleAuth, code: v.replace(/\D/g, "").slice(0, 6) })} inputMode="numeric" placeholder="6 digits" />
      </div>
      <div className="v-button-row"><span className="v-doc-meta">Policy updates are authenticated and audited.</span><button type="submit" className="v-btn primary" disabled={savingRules || !ruleAuth.password}>{savingRules ? "Saving rules…" : "Save onboarding requirements"}</button></div>
    </form>}
  </section>;
}
function Detail({ label, value }: { label: string; value: string }) {
  return <div className="v-detail"><span>{label}</span><strong>{value || "Not provided"}</strong></div>;
}

export default VendorWorkspace;
