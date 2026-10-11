# Prisma migrations and safe fixtures

`packages/database/prisma/schema.prisma` is the development schema source of truth.
The initial migration is `20261010171415_m01_foundation`.

Models: Organization, Domain, OrganizationSetting, ModuleDefinition, OrganizationModule,
OutboxEvent, IdempotencyRecord, WorkerHeartbeat and SmokeJobEffect.
Tenant records carry organizationId, relational foreign keys, and org-scoped uniqueness.
ModuleDefinition and the single-worker heartbeat are deployment-level infrastructure.

Commands:

1. `pnpm db:generate`
2. `pnpm db:migrate` — apply committed migrations, never reset a database.
3. `pnpm db:seed:dev` — idempotent synthetic fixture upserts; refuses production NODE_ENV.
4. `pnpm db:verify:clean` — apply migrations in a randomly named empty schema in the
   development database, verify foundation tables, drop only that disposable schema.

The clean migration check proves empty-schema application, not a backup/restore or production migration.
Readiness verifies the expected M01 migration, a live DB connection and a worker heartbeat under 30 seconds old.
Future migrations must update the readiness schema-version expectation.

Idempotency records scope keys by organisation, actor and operation. The request hash must be computed
from canonical input by the future calling service. Atomic database effects and stored results commit
in one transaction; mismatched content is rejected. External provider effects do not belong inside this
primitive and require the later recoverable workflow modules. Expiry is retained for future cleanup;
automatic key reuse/retention policies are not implemented.

## Production boundary

No production database has been migrated or seeded. The production database is separate.
Before release, the owner must confirm the target database, backup/restore plan, schema diff
and migration command against the hosting provider's deployment guidance. Never run the
synthetic seed in a production release.
