# Project instructions

- Follow the platform-neutral architecture baseline in `docs/reference/` and the approved M02 handoff. Work only on `feat/m02-identity-access`; preserve M01 and do not begin M03 or later modules.
- Use TypeScript, Next.js App Router for web and REST APIs, PostgreSQL with Prisma, Better Auth with the Prisma adapter, and the separate Node.js worker. Do not reintroduce the generated Vite, Express or Drizzle starter.
- Keep business decisions in `docs/business-decisions.md` as TBC until approved. Do not invent financial, tax, KYC, return, provider or launch values.
- Use synthetic development data only. Do not use production credentials, send live messages or publish to production. Local/test messaging adapters must be disabled in production.
- Keep credentials in the workspace secret store. Do not print or commit secret values. `.env.example` documents names only.
- Before schema changes, review additive Prisma migrations and run them only against development or disposable test databases. Never run production migrations.
- Preserve organisation isolation, deny-by-default authorization, secure sessions, audit redaction, rate limits, and all completed M01 behavior.
- Run the required M02 unit, integration, HTTP/browser, M01 regression, lint, typecheck, migration, seed and build checks. Report blocked checks plainly; see `docs/verification-m02.md`.
