# ADR 0001: Reusable modular commerce foundation

- **Status:** Accepted for M01
- **Date:** 2026-10-10

## Decision

Use a TypeScript pnpm workspace with a Next.js App Router web/API application, a separate Node.js worker, PostgreSQL with Prisma, shared contracts and core packages, and provider-neutral adapter boundaries. Each client receives a dedicated deployment and database. Organization scope remains explicit in tenant-owned records and service calls.

## Consequences

- Core domain code does not import Next.js, Prisma, browser APIs or provider SDKs.
- `apps/web` owns presentation and thin REST route handlers; `apps/worker` owns durable background processing.
- M01 enables only the organization-configuration foundation. Later marketplace modules remain planned and inaccessible.
- Deployment/publish behavior and production migration ownership must be revalidated before any release.

## Source decisions

The supplied System Architecture and the user's explicit M01 stack approval are authoritative. Business decisions remain in `docs/business-decisions.md`.
