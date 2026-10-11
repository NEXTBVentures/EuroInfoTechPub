"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useBfcacheGuard } from "./ui";
import "../../app/identity.css";

export function IdentityShell({ eyebrow, title, sub, children, wide }: { eyebrow: string; title: string; sub?: ReactNode; children: ReactNode; wide?: boolean }) {
  useBfcacheGuard();
  return (
    <div className="id-wrap">
      <aside className="id-side">
        <Link href="/" className="brand" style={{ color: "inherit", textDecoration: "none" }}>
          <span className="mark">EI</span>
          <span>
            <h1 style={{ fontSize: 18, margin: 0 }}>Euro Infotech</h1>
            <p>Account access</p>
          </span>
        </Link>
        <div>
          <span className="eyebrow">Secure sign-in</span>
          <h2>One account for buyers, sellers and staff.</h2>
          <p className="lede">Sessions live in secure cookies, sensitive changes ask for your password again, and staff access requires an authenticator app.</p>
        </div>
        <ul className="id-trust">
          <li>HttpOnly session cookies, no browser tokens</li>
          <li>Authenticator-app protection for admin staff</li>
          <li>Sign out any device from account security</li>
        </ul>
      </aside>
      <main className="id-main">
        <section className={`id-card${wide ? " wide" : ""}`} aria-labelledby="id-title">
          <span className="eyebrow">{eyebrow}</span>
          <h1 id="id-title">{title}</h1>
          {sub && <p className="sub">{sub}</p>}
          {children}
        </section>
      </main>
    </div>
  );
}
