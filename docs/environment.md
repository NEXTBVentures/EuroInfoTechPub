# Development environment and process commands

Node.js 24 and pnpm 10.26.1 are pinned. Install with `pnpm install --frozen-lockfile`.
Run `pnpm db:generate` after installation (generated Prisma client is not committed).
`pnpm contracts:codegen` regenerates the committed OpenAPI TypeScript contract.

Configure `DATABASE_URL` through workspace Secrets or your local environment. Never commit or print it.
The managed development PostgreSQL database is used here; production has not been accessed or changed.
For local terminal use, export the variables from `.env.example` with your local database URL.
Prisma CLI also loads a local `.env` from its package working directory.

| Variable | Purpose |
| --- | --- |
| DATABASE_URL | PostgreSQL connection; required by web/worker/CLI |
| PORT | Single public web port; default 3000; the development preview uses 25778 |
| CLIENT_CONFIG_KEY | Explicit dev fallback client key, default euro-infotech |
| ALLOW_UNMAPPED_DOMAIN_IN_DEV | Default false; true permits fallback only under NODE_ENV=development |
| E2E_BASE_URL | Optional verification endpoint; otherwise the configured preview domain, or local port 3000 |
| E2E_DIRECT_URL | Direct local web port for the unknown Host check; development preview uses http://127.0.0.1:25778 |
| SEED_ENV | Seed safety gate; dev seed command sets development; production NODE_ENV is rejected |

The seed registers localhost, 127.0.0.1, synthetic test domains and the configured development preview domain.
Unknown Host headers are rejected by default. Forwarded host headers are not trusted.
Configuration responses are no-store, allowlisted, and contain no provider credentials or private settings.

`pnpm dev` supervises separate web and worker children and terminates both if either fails.
The preview runs the web process and a separate `M01 worker` process.
`pnpm build` builds both processes; `pnpm start` supervises their built entry points.
These are local production-mode checks, not a published production release.

## Provider adapters

The queue uses pg-boss behind `QueuePort`. PostgreSQL 16.10 supports pg-boss 12.37.1;
the development role can create its private `pgboss` schema. Retry configuration is durable.
Handler exceptions trigger queue retries; business effects use a unique organisation/job key.
Outbox publishing can deliver more than once after a crash; consumers must remain idempotent.
Payments, shipping, messaging and AI expose disabled, provider-neutral contracts only.
No object-storage uploads or provider operations are implemented in M01.

## Limits

### M02 authentication configuration

- `BETTER_AUTH_SECRET`: secret of at least 32 characters; existing `SESSION_SECRET` is
  the supported fallback. Never commit either. CI creates a disposable random secret.
- `BETTER_AUTH_URL`: explicit origin for local/auth callbacks when required;
  development requests can resolve their origin from the trusted request.
- `AUTH_TRUSTED_ORIGINS`: optional comma-separated additional origins; do not use wildcards.
  Development loopback and the configured preview origin are supported.
- `AUTH_MFA_SECRET`: optional separate stable secret of at least 32 characters for encrypted
  TOTP credentials and keyed recovery/OTP hashes. Falls back to the authentication secret.
  Changing this key requires an explicit re-enrolment/recovery plan; there is no silent fallback
  to an old key after rotation.
- `AUTH_TEST_ADAPTERS`: defaults false. True enables ephemeral test capture only outside
  `NODE_ENV=production`. Production delivery always refuses this adapter even if the flag is set.
  It never prints messages or exposes an HTTP inbox. Live email/SMS providers are not configured.

### M03 vendor data configuration

- `VENDOR_BANK_ENCRYPTION_KEY_V1`: Base64-encoded 32-byte key used for AES-256-GCM bank-profile
  encryption. Store it only in workspace Secrets. Missing or invalid keys cause bank-profile
  writes to fail closed; never log, print or commit the value.
- `VENDOR_BANK_ENCRYPTION_KEY_VERSION`: Optional active key version; defaults to `v1`.
  Keep prior version keys available while ciphertext still uses them. Rotation/re-encryption
  must be planned before removing an older key.
- `VENDOR_DOCUMENT_STORAGE_DIR`: private local directory for development and tests only.
  The local adapter refuses production/published environments. No production object-storage
  provider is configured; choose an approved private provider before enabling vendor uploads
  in a published deployment.
- Vendor invitations use one-time hashed tokens and return a link for the inviter to share.
  Email/SMS is not configured and no delivery is claimed. The current 72-hour expiry is a
  technical default pending the business decision register.

Use the existing `CLIENT_CONFIG_KEY`, domain mapping and explicit
`ALLOW_DEV_CLIENT_CONFIG_FALLBACK` only in development. Unknown hosts fail closed otherwise.
Identity fixture tools refuse published deployments. Do not rely on a generic
environment label as the deployment detector: development infrastructure may expose
the value `production`.

One supervised worker is supported by the M01 heartbeat identity. Do not scale replicas until
per-instance heartbeat ownership and multi-worker readiness policy are implemented.
The client deployment/database is dedicated; the second organisation is a synthetic isolation fixture.
Brand tokens are provisional. Business decisions remain TBC in `business-decisions.md`.

The automatically registered artifact still has a static production-serving declaration.
That declaration is not used by the development workflow or `pnpm start`.
Before any release, replace it through the validated artifact configuration flow with the
supervised Next.js/worker command. Production packaging/publishing is not verified or authorized here.
