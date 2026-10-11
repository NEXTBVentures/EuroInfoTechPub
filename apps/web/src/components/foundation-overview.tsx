"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicClientConfig, ReadinessResponse } from "@workspace/contracts";
import { getPublicConfig, getReadiness } from "../lib/foundation-api";

type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; data: T };
type Filter = "all" | "implemented" | "planned";

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg className={spinning ? "spin" : undefined} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sk" style={{ width: `${92 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="err" role="alert">
      <span>{message}</span>
      <button className="btn" onClick={onRetry}>Retry</button>
    </div>
  );
}

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export function FoundationOverview() {
  const [config, setConfig] = useState<Load<PublicClientConfig>>({ status: "loading" });
  const [ready, setReady] = useState<Load<ReadinessResponse>>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const loadConfig = useCallback(async (soft = false) => {
    if (!soft) setConfig({ status: "loading" });
    try { setConfig({ status: "ok", data: await getPublicConfig() }); }
    catch (e) { setConfig({ status: "error", message: errMsg(e, "Public configuration is unavailable") }); }
  }, []);

  const loadReady = useCallback(async (soft = false) => {
    if (!soft) setReady({ status: "loading" });
    try { setReady({ status: "ok", data: await getReadiness() }); }
    catch (e) { setReady({ status: "error", message: errMsg(e, "Readiness check could not be completed") }); }
    setCheckedAt(new Date());
  }, []);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadConfig(true), loadReady(true)]);
    setRefreshing(false);
  }, [loadConfig, loadReady]);

  useEffect(() => { void loadConfig(); void loadReady(); }, [loadConfig, loadReady]);

  const cfg = config.status === "ok" ? config.data : null;
  const modules = cfg?.modules ?? [];
  const implemented = modules.filter((m) => m.status === "implemented");
  const planned = modules.filter((m) => m.status === "planned");
  const shown = filter === "all" ? modules : modules.filter((m) => m.status === filter);
  const tz = cfg?.timeZone ?? "Asia/Kolkata";

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <div className="mark" aria-hidden="true">EI</div>
          <div>
            <h1>{cfg?.displayName ?? "Euro Infotech"}</h1>
            <p>Commerce foundation{cfg ? ` / project ${cfg.projectCode}` : ""}</p>
          </div>
        </div>
        <a className="btn" href="/login">Sign in</a>
        <button className="btn" onClick={refreshAll} disabled={refreshing} aria-live="polite">
          <RefreshIcon spinning={refreshing} />
          {refreshing ? "Refreshing" : "Refresh status"}
        </button>
      </header>

      <section className="hero">
        <div>
          <span className="eyebrow">Foundation overview</span>
          <h2>What is running today, and what is still on the plan.</h2>
          <p>
            A dedicated multi-vendor commerce foundation. This page reads live configuration and
            service readiness from the running services. Nothing here is a storefront, and no
            commerce feature is implied until its module is marked implemented.
          </p>
        </div>
        <div className="notice">
          <strong>Not production ready</strong>
          {cfg
            ? `${implemented.length} of ${modules.length} modules implemented. ${planned.length} remain planned.`
            : "Loading module status from configuration."}
        </div>
      </section>

      <div className="grid">
        <section className="panel" aria-labelledby="cfg-h" aria-busy={config.status === "loading"}>
          <h3 id="cfg-h">Client configuration</h3>
          <p className="sub">From /api/v1/public-config</p>
          {config.status === "loading" && <Skeleton rows={8} />}
          {config.status === "error" && <ErrorBox message={config.message} onRetry={() => loadConfig()} />}
          {cfg && (
            <dl className="kv">
              <dt>Client key</dt><dd>{cfg.clientKey}</dd>
              <dt>Project code</dt><dd>{cfg.projectCode}</dd>
              <dt>Locale</dt><dd>{cfg.locale}</dd>
              <dt>Currency</dt><dd>{cfg.currency}</dd>
              <dt>Time zone</dt><dd>{cfg.timeZone}</dd>
              <dt>Core version</dt><dd>{cfg.coreVersion}</dd>
              <dt>Schema version</dt><dd>{cfg.schemaVersion}</dd>
              <dt>Production</dt><dd><span className="pill warn">Not ready</span></dd>
            </dl>
          )}
        </section>

        <section className="panel" aria-labelledby="rd-h" aria-busy={ready.status === "loading"}>
          <h3 id="rd-h">Service readiness</h3>
          <p className="sub">
            From /api/readyz
            {checkedAt && ` / checked ${checkedAt.toLocaleTimeString("en-IN", { timeZone: tz })}`}
          </p>
          {ready.status === "loading" && <Skeleton rows={4} />}
          {ready.status === "error" && <ErrorBox message={ready.message} onRetry={() => loadReady()} />}
          {ready.status === "ok" && (
            <div aria-live="polite">
              <div className="overall">
                <span>Overall</span>
                <span className={`pill ${ready.data.ready ? "ok" : "bad"}`}>{ready.data.ready ? "Ready" : "Not ready"}</span>
              </div>
              <div className="checks">
                {(["database", "migrations", "worker"] as const).map((k) => {
                  const ok = ready.data.checks[k] === "ready";
                  return (
                    <div className="check" key={k}>
                      <span style={{ textTransform: "capitalize" }}>{k}</span>
                      <span className={`pill ${ok ? "ok" : "bad"}`}>{ok ? "Ready" : "Not ready"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </div>

      <section aria-labelledby="mod-h">
        <div className="modhead">
          <div>
            <span className="eyebrow">Module register</span>
            <h3 id="mod-h">Modules</h3>
          </div>
          <div className="tabs" role="group" aria-label="Filter modules">
            {(["all", "implemented", "planned"] as const).map((f) => (
              <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f === "implemented" ? "Implemented" : "Planned"}
                {cfg && ` (${f === "all" ? modules.length : f === "implemented" ? implemented.length : planned.length})`}
              </button>
            ))}
          </div>
        </div>
        {config.status === "loading" && <div className="panel"><Skeleton rows={6} /></div>}
        {config.status === "error" && <ErrorBox message="Modules cannot be listed until configuration loads." onRetry={() => loadConfig()} />}
        {cfg && (shown.length === 0 ? (
          <div className="mods"><div className="empty" style={{ gridColumn: "1 / -1" }}>No modules in this view.</div></div>
        ) : (
          <ul className="mods" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {shown.map((m, i) => {
              const live = m.status === "implemented";
              return (
                <li key={m.key} className={`mod${live ? " live" : ""}`} style={{ animationDelay: `${Math.min(i, 20) * 20}ms` }}>
                  <header>
                    <div>
                      <h4>{m.name}</h4>
                      <code>{m.key}</code>
                    </div>
                    <span className={`pill ${live ? "ok" : "plan"}`}>{live ? "Implemented" : "Planned"}</span>
                  </header>
                  {m.description && <p>{m.description}</p>}
                  <small>
                    {live ? (m.enabled ? "Enabled for this client" : "Implemented, disabled") : "Planned, not available yet"}
                  </small>
                </li>
              );
            })}
          </ul>
        ))}
      </section>

      <footer className="foot">
        <span>Core {cfg?.coreVersion ?? "-"} / dedicated client deployment</span>
        <span className="tokens">
          <i style={{ background: "var(--ink)" }} />
          <i style={{ background: "var(--accent)" }} />
          <i style={{ background: "var(--paper)" }} />
          Provisional visual tokens, customer branding pending
        </span>
      </footer>
    </div>
  );
}
