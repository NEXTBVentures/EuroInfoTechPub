# M03 verification

M03 is implemented on `feat/m03-vendor-onboarding`. The checks below cover the M03 code and the retained M01/M02 regressions. All fixtures are synthetic and use the development database only.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; the lockfile is unchanged |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed; builds the Next.js web app and the separate worker |
| `pnpm test` | Final-HEAD gate: 31 tests across 8 files |
| `pnpm test:integration` | Final-HEAD gate: 45 tests across 5 files, including 19 real authenticated M03 route scenarios |
| `pnpm db:migrate` | Passed; applied the additive M03 migration to the development database |
| `pnpm db:verify:clean` | Passed; applied the full migration chain through M03 to a clean schema |
| `pnpm db:verify:m03` | Final-HEAD gate: disposable M02 upgrade, existing organization/identity/membership preservation and empty upgraded/development schema drift |
| `pnpm db:seed:dev` twice | Passed; repeat seed is idempotent |
| `pnpm test:browser` | Passed; public configuration, readiness, module filters, retry states, and mobile layout |
| `pnpm test:e2e` | Passed; health/configuration allowlist, domain rejection, private-route redirects, and readiness |
| `pnpm test:identity:browser` | Passed; M02 authentication/security flows and M03 vendor draft save/reload in a real browser |
| `pnpm test:recovery` | Passed; readiness recovery, queued-job recovery, duplicate-delivery safety, restart, and fail-closed vendor notifications |
| `pnpm test:vendor:browser` | Exploratory pass; final-HEAD gate: 8 M03 scenario groups, real admin decisions and 1280/402-pixel layouts |
| `pnpm exec tsx scripts/verify-seed.ts` | Final-HEAD gate: two repeat seeds preserve seeded organization IDs and all fixture counts |
| `pnpm contracts:codegen` then `git diff --exit-code -- packages/contracts/src/openapi.generated.ts` | Final-HEAD gate: generated contracts unchanged |

Earlier passes do not substitute for final-HEAD verification. Acceptance requires every command above to succeed on the same committed HEAD, followed by remote feature-branch/PR-head equality and a clean tree. The final command log and Git evidence identify the tested SHA separately, avoiding a self-referential commit hash in this document.

The framework-generated `next-env.d.ts` is excluded from Git because development and build regenerate different import paths. Web typecheck runs `next typegen` first so fresh checkouts generate their own route declarations. Build/dev output must not alter tracked source.

## Security review and fixes

- Draft creation locks the applicant membership. Profile edits, document replacement and submission share an application row lock. Duplicate submission returns the same revision. Outbox failure rolls back submission and audit state.
- Repeated lifecycle decisions are idempotent, without duplicate approval assignments, decisions or events. Admin review is organization-scoped and permission-specific, with enrolled/fresh MFA and password/TOTP reauthentication.
- KYC storage uses opaque UUID paths and sanitized display names. Traversal, public roots, public symlinks, permissive directories and document symlinks are refused. Scoped authenticated reads return private/no-store attachments. Size, allowed MIME and magic bytes are checked before storage.
- Bank profiles use versioned AES-256-GCM; ordinary reads/writes return masked values and missing/invalid encryption keys fail closed. Unauthorized and cross-vendor changes are denied.
- Pending, rejected and suspended vendors cannot obtain active vendor capabilities.
- Invitation creation/acceptance have transactional identifier-only outbox events. Tokens are hash-only, expiring and single-use, with organization/verified-contact checks. Staff removal and permission changes revoke sessions. Bank-access changes preserve unrelated staff grants.
- Audit metadata contains field names, identifiers, revision/status/category and masked bank tails, not full KYC/address values, full bank values, ciphertext, credentials, bearer tokens or contact values. Incoming request URL logging is disabled.
- Fixture passwords and keys are generated at runtime. Fixtures refuse published projects and use scoped cleanup. No real credentials, private keys, uploaded files, generated artifacts or temporary schemas belong in the change set.

## Migration inventory and safety

The only new migration is `20261011203000_m03_vendor_onboarding`; M01/M02 migration SQL is unchanged from the merged M02 base.

Three enums: `VendorStatus`, `VendorApplicationStatus`, `VendorBankVerificationStatus`.

Nine tables: `Vendor`, `VendorApplication`, `VendorSubmission`, `VendorDocument`, `VendorDecision`, `VendorStaffInvitation`, `VendorStaffPermission`, `VendorBankProfile`, `VendorAuditEvent`.

The migration SQL supplies the exact named primary, foreign-key, uniqueness/check constraints and indexes. These include organization-scoped composite foreign keys; one active application per applicant; unique revision, storage-key and token-hash indexes; organization/vendor lookup indexes; positive document size, minimum decision reason, invitation contact and four-digit bank-tail checks. Foreign-key `ON DELETE` clauses are referential policy, not executed data deletion.

There are no `DROP`, `TRUNCATE`, `DELETE`, `UPDATE` or existing-table recreation statements in this migration. Verification creates/drops only randomly named disposable development schemas. Existing-M02 upgrade and full clean-schema migration are separate checks; existing synthetic identity rows must be preserved and Prisma drift must be empty.

## Operational limits

- M03 does not make the application production-ready. Private production document storage, the bank-encryption key, and an email/SMS delivery provider remain unconfigured.
- Vendor notification events intentionally remain pending/fail-closed until a delivery provider is configured.
- No production database or publishing operation was used for this verification.
- M04 and later marketplace modules remain out of scope.
- Production content/malware scanning is not implemented or claimed. Configurable KYC rules, required evidence, reviewer policy/retention, delivery providers and final invitation expiry remain business decisions; technical defaults are not business approval.
