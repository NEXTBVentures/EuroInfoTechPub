"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ROLE_LABELS, type RoleKey } from "@workspace/core";
import { authClient } from "../../lib/auth-client";
import { hardReplace, useBfcacheGuard } from "./ui";
import "../../app/identity.css";

export function roleLabel(key: string) {
  return ROLE_LABELS[key as RoleKey] ?? key;
}

export type IdentityAreaProps = {
  area: "Customer" | "Vendor" | "Admin";
  name: string;
  organizationName: string;
  roles: string[];
  permissions: string[];
  children?: ReactNode;
};

export function IdentityArea({ area, name, organizationName, roles, permissions, children }: IdentityAreaProps) {
  useBfcacheGuard(true);
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutErr, setSignOutErr] = useState<string | null>(null);

  async function signOut() {
    setSigningOut(true); setSignOutErr(null);
    const { error } = await authClient.signOut();
    if (error) { setSigningOut(false); setSignOutErr(error.message || "Sign out failed. Try again."); return; }
    hardReplace("/login?notice=signed-out", "/login");
  }

  const isVendor = roles.includes("VENDOR_OWNER") || roles.includes("VENDOR_STAFF");
  const isAdmin = roles.includes("ADMIN_STAFF") || roles.includes("ORGANISATION_OWNER");
  const nav = [
    { href: "/account", label: "Account", show: true },
    { href: "/account/security", label: "Security", show: true },
    { href: "/vendor", label: isVendor ? "Vendor" : "Apply to sell", show: isVendor || roles.includes("CUSTOMER") },
    { href: "/admin", label: "Admin", show: isAdmin },
  ].filter((n) => n.show);
  const initials = (name || "?").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="ia">
      <header className="ia-top">
        <Link href="/" className="brand" style={{ color: "inherit", textDecoration: "none" }}>
          <span className="mark">EI</span>
          <span><h1>Euro Infotech</h1><p>{organizationName} / {area}</p></span>
        </Link>
        <nav className="ia-nav" aria-label={`${area} navigation`}>
          {nav.map((n) => <a key={n.href} href={n.href} aria-current={pathname === n.href ? "page" : undefined}>{n.label}</a>)}
        </nav>
        <div className="ia-who">
          <span className="ia-avatar" aria-hidden="true">{initials}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{name}<small>{area} area</small></span>
          <button type="button" className="btn small" onClick={signOut} disabled={signingOut}>{signingOut ? "Signing out" : "Sign out"}</button>
        </div>
      </header>
      {signOutErr && <div className="err" role="alert" style={{ marginTop: 12 }}><span>{signOutErr}</span><button type="button" className="btn small" onClick={signOut}>Retry</button></div>}
      <div className="ia-strip">
        {roles.length ? roles.map((r) => <span key={r} className="pill plan">{roleLabel(r)}</span>) : <span className="pill warn">No roles</span>}
        <span className="pill ok">{permissions.length} permission{permissions.length === 1 ? "" : "s"}</span>
      </div>
      <div className="ia-body">{children}</div>
    </div>
  );
}

export default IdentityArea;
