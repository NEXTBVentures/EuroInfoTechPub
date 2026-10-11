# 261002-EuroInfoTech
Reusable, secure multi-vendor e-commerce platform for Euro Infotech, featuring customer, vendor and admin portals, product management, vendor-wise orders, payments, shipping, commissions, payouts, returns, refunds, AI-assisted search and scalable marketplace operations.

## Current delivery: M01 foundation, M02 identity/access, M03 vendor onboarding

The introduction above describes the intended full platform, not completed features.
M01 implements configuration, module registry, isolation primitives, database migrations,
durable synthetic jobs, heartbeat/readiness and a responsive foundation overview.
M02 adds Better Auth email authentication, verified phone OTP login, tenant-scoped
memberships/permissions, mandatory administrator TOTP, recovery codes, and session management.
M03 adds vendor application drafts and review, private KYC files, audited admin decisions,
scoped vendor staff access and encrypted/masked bank profiles. Production document storage
and live email/SMS delivery are not configured. See [M03 guidance](docs/vendors.md).

### Stack and layout

- `apps/web`: TypeScript Next.js App Router web and REST APIs.
- `apps/worker`: separate Node.js worker, bundled built entry point.
- `packages/core`: domain-independent context, authorization, module and provider/queue ports.
- `packages/database`: PostgreSQL/Prisma models, migration, seed and scoped repositories.
- `packages/adapters`: pg-boss queue implementation.
- `packages/contracts`: Zod contracts and OpenAPI schema/code generation.
- `clients/euro-infotech`: validated non-secret client profile.
- `artifacts/euroinfo-commerce`: web artifact wrapper for the workspace app.
- `docs/reference`: platform-neutral architecture baseline; original upload remains unchanged.

### Setup and run

Use Node.js 24, pnpm 10.26.1, and a development PostgreSQL database.
Configure DATABASE_URL and BETTER_AUTH_SECRET (or the existing SESSION_SECRET) securely, then:

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm db:seed:dev
pnpm dev
```

`pnpm build` and `pnpm start` build and supervise both processes locally.
The web listens on PORT (default 3000); the worker has no public port.
Never run development seeds on production.

### Verification

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm db:verify:clean
pnpm test:e2e
pnpm test:recovery
pnpm test:browser
pnpm test:identity:browser
pnpm build
```

E2E requires a running web and worker. Recovery verification requires the managed
worker stopped; it owns a temporary worker process and checks stopped-worker readiness,
durable queued work, duplicate effects, and restart recovery.

See [environment setup](docs/environment.md), [database guidance](docs/database.md),
[module progress](docs/module-status.md), [business decisions](docs/business-decisions.md),
and verification evidence for [M01](docs/verification.md), [M02](docs/verification-m02.md),
and [M03](docs/verification-m03.md).

Email/SMS delivery is provider-neutral and disabled by default. `AUTH_TEST_ADAPTERS=true`
enables an ephemeral in-process capture adapter outside production only; integration tests
consume it without exposing an inbox endpoint or logging messages. No live messages are sent.
Never enable test adapters on a release. Authentication pages start at `/login`.

The repeatable development seed has inert synthetic users, not shared passwords.
For an existing, email-verified, TOTP-enrolled development customer, an operator can run
`SEED_ENV=development pnpm identity:grant-owner <registered-email> [organization-key]`.
This command refuses published/production targets, creates no credentials, and requires a fresh
MFA challenge afterwards. Automated browser fixtures are temporary and deleted after testing.

No production publishing, live money, live email/SMS, AI integrations or M04 marketplace
catalogue work is included.
