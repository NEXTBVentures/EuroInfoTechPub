# M01 verification and handoff — 2026-10-10

## Initial assessment

Work continued on the existing `feat/m01-foundation`, tracking the matching origin branch.
Origin main and the feature branch were still at the README-only repository baseline.
Local foundation boilerplate and preserved-document commits existed, but the active artifact
still referenced a generated Vite starter and failed to start. There was no committed migration,
seed, complete test coverage, working foundation shell or verified PR.
Local main contains unrelated earlier commits; it was intentionally left untouched.

## Delivered

- Replaced confirmed generated Vite/Express/Drizzle starter apps with the approved
  Next.js App Router + Prisma/PostgreSQL + separate Node worker architecture.
- Kept SSH remote, repository history, original README introduction and supplied source documents.
- Added a generated lockfile, coherent workspace commands, environment instructions,
  AGENTS guidance, business-decision register, ADRs and automated GitHub gate definition.
- Validated synthetic client configuration, domain allowlist, allowlisted public config,
  implemented/planned module registry and inaccessible future private panels.
- Added tenant-scoped repository and deny-by-default primitives, transactional idempotency,
  durable outbox publishing, PostgreSQL queue port, synthetic smoke consumer and heartbeat.
- Added a responsive live-data shell with filters, refresh, loading, failure/retry and readiness.
- Initial Prisma migration and safe repeatable seed are documented in `database.md`.

Principal changes: `apps/web`, `apps/worker`, `packages/core`, `packages/contracts`,
`packages/database`, `packages/adapters`, `clients/euro-infotech`, `scripts`, `docs`,
workspace/configuration files, `.github/workflows/m01.yml`, and the existing artifact wrapper.
The original generated starter frontend/components were removed after confirming they were not required work.

## Checks actually executed locally

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm db:generate` | Passed |
| `pnpm contracts:codegen` | Passed |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed for packages/apps and verification scripts |
| `pnpm test` | 7 unit tests passed |
| `pnpm test:integration` | 4 real PostgreSQL tests passed |
| `pnpm db:migrate` | Passed; no pending committed migrations |
| `pnpm db:verify:clean` | Passed in an empty disposable dev schema; schema cleaned up |
| `pnpm exec tsx scripts/verify-seed.ts` | Passed; two repeat seeds retain org IDs and row counts |
| `pnpm build` | Next.js optimized build and standalone bundled worker build passed |
| `PORT=3001 pnpm start` | Built web and worker both started, readiness ready |
| `E2E_BASE_URL=http://127.0.0.1:3001 pnpm test:e2e` | Built runtime HTTP smoke passed |
| `E2E_DIRECT_URL=http://127.0.0.1:25778 pnpm test:e2e` | Managed preview HTTP smoke passed |
| `pnpm test:recovery` | Stopped-worker 503, persisted queued work, duplicate delivery/single effect and restart passed |
| `pnpm test:browser` | Live config/readiness, 21/1/20 filters, refresh, aborted-request/retry, 503 state and mobile layout passed |
| Public config before/after web workflow restart | Byte-identical |

Browser checks used real Chromium through Playwright after the supplied browser-agent configuration
was rejected by the dispatcher. Simulated network failures intentionally generate resource errors;
the check asserts no uncaught JavaScript page errors. Desktop/mobile screenshots are generated output,
not repository assets. The shell remains explicitly not production-ready.

Integration coverage includes org isolation, disabled module guards, simultaneous idempotent requests,
different-content rejection, queue claim/complete, terminal dead-letter routing and failed-job retry.
Unknown domain configuration and `/admin`, `/account`, `/vendor` return 404.
No authentication bypass, fixed demo passwords, real users, live payments, uploads, OTP, messaging or AI calls.

## Repository and release boundary

Fetched origin main and feature branch; merging each into the feature branch reported already up to date.
This makes the checked feature tree the current merge candidate against remote main without touching local main.

SSH repository access works. GitHub CLI has no PR/API authorization and the active source-control
connection does not expose credentials through the API connector helper. No PR was created in this session.
No PR references were returned by SSH, but existing PRs and repository rules cannot be conclusively inspected.
GitHub Actions execution, required checks, review/rules, PR merge, and post-merge main smoke remain unverified.
Do not interpret passing local checks as passing GitHub checks or permission to merge.

The registered artifact's old static production-serving metadata still needs replacement through
the validated artifact configuration flow before a release. Direct edits are prohibited;
development preview and local supervised start are working independently.
No production DB, publishing or M02 work was performed. TBC business/brand decisions remain TBC.
