# M02 verification evidence

Verified on 2026-10-11 (Asia/Kolkata) using the development database and temporary synthetic
fixtures only. No production database access, real messages, M03 work or publishing.

## Source control

- Verified base `origin/main`: `9ff6260de2598f5bb1875a18472bbcab3a635e1a`.
- Base contains merged M01 `4d7af529bc1cad95bee6f3d329eb1ff548bb715a`.
- Branch: `feat/m02-identity-access`, created and initially pushed from that base.
- Tested implementation SHA: `e39fa06beb46340ebb0869605cfebdcdcbefbfcd`.
- The following documentation/metadata commit records these results and Next.js-generated
  environment declarations. No implementation changes followed the passing checks.
  The final branch head is available with `git rev-parse HEAD`.
- No force push, main edits or automatic merge.

## Exact results

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS; locked official registry packages |
| `pnpm lint` | PASS; no errors or warnings |
| `pnpm typecheck` | PASS across all workspaces, root scripts and identity browser script |
| `pnpm test` | PASS: 5 files, 17 tests |
| `pnpm test:integration` | PASS: 3 files, 22 tests, including all 4 original M01 integration tests |
| `pnpm contracts:codegen` + generated-contract diff | PASS; foundation OpenAPI generated output unchanged |
| `pnpm db:migrate` | PASS; reviewed additive M02 migration applied to development |
| `pnpm db:verify:clean` | PASS; both migrations apply to an empty disposable PostgreSQL schema, then schema removed |
| `pnpm exec tsx scripts/verify-seed.ts` | PASS; two repeat seeds retain IDs and M01/M02 fixture counts |
| Prisma migrate diff, datasource → schema, `--exit-code` | PASS; no difference detected |
| `pnpm build` | PASS; Next.js optimized production build (13 static pages) and separate bundled worker |
| `E2E_DIRECT_URL=http://127.0.0.1:25778 pnpm test:e2e` | PASS; shell, configuration allowlist, health/readiness, unknown domain and private redirects |
| `pnpm test:recovery` with managed worker stopped | PASS; stopped-worker readiness, durable queued work, duplicate delivery single effect and restart recovery |
| `pnpm test:browser` | PASS; live config/readiness, filters, refresh, failure/retry, 503 state and mobile layout; no page errors |
| `pnpm test:identity:browser` | PASS; desktop/mobile auth pages, validation, actual login, role denial, session revoke/all logout, TOTP setup/recovery/admin gate and logout back/forward protection; no page errors |

Unit coverage includes tenant-host validation, safe redirects, deny-by-default permissions,
OTP policy, RFC TOTP vectors/replay windows, authenticated secret encryption and user-bound
recovery hashes. Integration coverage uses actual official auth handlers and local captured
verification/reset/OTP messages, not fabricated auth responses.

Integration coverage includes duplicate registration, mandatory verified email, HttpOnly/Lax
cookies, cross-tenant denial/composite FK enforcement, membership isolation, all-session password
reset invalidation, verified phone linking and OTP-only login, resend cooldown, attempt expiry
and atomic single use, pending/approved/other-vendor scope, hashed recovery codes, TOTP replay,
concurrent recovery redemption, no email/phone MFA bypass, privileged role re-authentication,
no secret re-exposure, no privileged TOTP removal, non-admin removal, audit redaction,
shared security caps and serial/concurrent login caps.

The browser fixture is a randomly credentialed, verified synthetic customer inserted into the
development database and deleted afterwards. It signs in through the real HTTP endpoints,
enrols TOTP through the actual UI, and uses real one-time recovery codes for the admin challenge.
Fixture-only role provisioning exercises an authorised admin; it does not introduce a UI or
production authorization bypass. No signed-in routes were bypassed for screenshots.
Generated screenshots remain in ignored `generated-artifacts/`.

## Migrations and preserved M01 behavior

- `20261010171415_m01_foundation`: unchanged.
- `20261010194554_m02_identity_access`: new tables, enums, indexes and foreign keys only;
  no drops or foundation-data rewrites.

Readiness now verifies the required applied migration set and refuses unfinished migrations,
rather than assuming the latest migration is always M01. Worker heartbeat/recovery remains intact.
The 21-module registry now reports two implemented/enabled modules and 19 planned modules.
Private anonymous routes intentionally redirect to login instead of the old not-found placeholders.
M01 configuration allowlists, isolation, provider-disabled behavior and recovery guarantees remain.

## Limits and handoff

- Live email/SMS providers and credentials are not configured. The capture adapter is
  ephemeral, test-only and disabled in production. The preview safely reports disabled delivery.
- No fixed customer/admin passwords, operational impersonation or standing NEXTB data access.
- Vendor membership approval/onboarding, payments, KYC, catalogue/order business workflows and
  all M03+ features remain unimplemented.
- SSH read/write repository access is confirmed. GitHub CLI reports no authenticated hosts;
  the active source-control integration did not supply CLI/API authorization for creating a PR.
  A PR must not be claimed as created. The pushed branch can be reviewed through GitHub's
  `main...feat/m02-identity-access` comparison and submitted there.
- GitHub-hosted CI, required review and merge are not verified or authorised by these local checks.
- No PR merge or production publishing was performed. Existing M01 production packaging
  limitations still apply; productionReady remains false.

See `identity.md`, `environment.md`, `.env.example` and README for names-only configuration,
permission/route contracts, local-provider behavior and development owner provisioning.
