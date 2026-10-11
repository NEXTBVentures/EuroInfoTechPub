# NEXTB Commerce Core — System Architecture Baseline

Reusable architecture and development guidance for Euro Infotech (project 261002), prepared
by NEXTB PRIVATE LIMITED on 10 October 2026. This repository copy is platform-neutral.
The original uploaded source document remains unchanged in the project attachments.

## Purpose and architecture

Build a reusable commerce foundation for Euro Infotech and future clients. Use a modular
monolith: one shared application with clearly owned modules, a responsive web application,
REST APIs and a separate background worker. Business rules must be shared across web and
future mobile channels.

Deploy each client with a separate application environment, database, secrets, object-storage
namespace and production domains by default. A vendor is a seller inside a client organisation,
not a separate client tenant. Shared multi-organisation SaaS, cross-client billing and central
customer identity are separate future projects; tenant columns alone do not provide safe
cross-client isolation.

Reuse modules, migrations, contracts and tests. Keep client branding, feature switches and
approved business policies in versioned configuration. Core code must not contain client
names, domains, financial rates or provider credentials. Apply upstream changes through
reviewed merges and regression checks; do not copy live client data.

## Stack and repository boundaries

Use TypeScript throughout. Preserve the approved architecture and exact package lockfile:

| Area | Baseline |
| --- | --- |
| Web/API | Next.js App Router, React, Node.js runtime, versioned REST handlers |
| UI | Accessible, responsive components and shared design tokens |
| Database | PostgreSQL, Prisma, reviewed additive SQL migrations |
| Validation/contracts | Shared Zod schemas and generated OpenAPI contracts |
| Identity | Better Auth with Prisma adapter |
| Jobs | pg-boss behind an application-owned queue interface |
| Search | PostgreSQL full-text search; optional extensions only after testing |
| Tests | Vitest, isolated real-PostgreSQL integration tests and Playwright |

Do not silently upgrade or replace the stack. Verify compatible runtime, database and queue
versions before introducing changes.

| Repository area | Ownership |
| --- | --- |
| `apps/web` | Pages, layouts, thin REST handlers, auth routes and composition root |
| `apps/worker` | Job handlers, outbox dispatch, reconciliation and scheduled work |
| `packages/core` | Domain services, application rules, policies and repository interfaces |
| `packages/database` | Prisma schema, SQL migrations, scoped repositories and safe seeds |
| `packages/contracts` | Zod schemas, event envelopes and API documentation |
| `packages/adapters` | Database, queue and provider implementations |
| `packages/ui`, `packages/config` | Shared components, config validation and module registry |
| `clients/euro-infotech` | Non-secret client profile |

Core domain code must not import Next.js, browser APIs, Prisma or external provider SDKs.
Inject adapters at composition boundaries. Modules use public services and events rather than
writing other modules' tables. No distributed cache, orchestrator or microservices are needed
for the initial delivery.

## Client isolation and authorization

- Every tenant-owned record and job carries `organizationId`; seller-owned data also carries
  `vendorId`. Use composite foreign keys and organisation-scoped repository methods.
- Resolve the organisation from a configured, allowlisted domain. Never authorize from an
  organisation or vendor identifier supplied by the browser.
- Pass the authenticated actor and explicit scope into application services. Enforce permissions
  in services called from server rendering, APIs and background jobs.
- Enforce module switches on APIs and workers, not just menus. Disabling a module must not strand
  existing orders, refunds or payouts.
- Use deployment-per-client isolation by default. Cross-client data sharing needs separate
  architecture and security review.

## Functional modules and delivery sequence

| Module | Scope | Stage |
| --- | --- | --- |
| Organisation configuration | Tenant domains, settings, module registry | M01 |
| Identity and access | Customer accounts, verified email/phone, sessions, admin 2FA and permissions | M02 |
| Vendors | Onboarding, KYC, approval, store profile, staff and bank details | M03 |
| Catalogue and inventory | Categories, products, media, variants, prices, stock and moderation | M04 |
| Discovery and cart | Search, filters, wishlist, cart, Buy Now and addresses | M05 |
| Pricing and promotions | Coupons, discounts and cross-vendor allocation | M05 / M10 |
| Orders | Customer orders, vendor sub-orders, cancellation and fulfilment state | M06 |
| Payments | Checkout, enabled payment methods, cash on delivery and refunds | M06 / M07 |
| Fulfilment | Serviceability, shipping quotes, labels, tracking and reverse pickup | M07 |
| Returns and reviews | Policy-driven returns, partial refunds, ratings and moderation | M07 |
| Commissions and payouts | Rules, earnings ledger, statements and approved payouts | M08 |
| AI assistance | Search and human-reviewed product-entry drafts | M09 |
| Operations and growth | Notifications, support, reports, CMS, SEO and analytics | M10 |
| Release hardening | User acceptance, recovery drill, security and handover | M11 |
| Additional channels | Customer and vendor mobile apps over shared APIs | Separate milestone |

Security, responsive accessibility, SEO and operational logging are cross-cutting requirements.
Keep coupons and AI scope explicitly tracked. Future milestones require explicit approval;
do not treat the roadmap as implementation authorization.

## Data and business integrity

Use UUID identifiers, UTC timestamps and explicit foreign keys. Store money as integer minor
units plus currency, and use decimal strings at API boundaries when needed. Keep financial
rows immutable and archive products referenced by transaction history.

| Domain | Principal entities |
| --- | --- |
| Configuration | Organisation, Domain, OrganisationSetting, ModuleDefinition, OrganisationModule |
| Identity | User, Session, Account, Verification, Membership, Role, Permission |
| Vendors | Vendor, VendorUser, VendorDocument, BankAccount, VendorReview |
| Catalogue | Category, Product, Variant, ProductMedia, Inventory, InventoryMovement |
| Shopping | Address, WishlistItem, Cart, CartItem, Quote, Promotion, Redemption |
| Orders | Order, VendorOrder, OrderItem, InventoryReservation, OrderEvent |
| Payments | PaymentAttempt, PaymentAllocation, ProviderEvent, Refund, RefundItem |
| Fulfilment | Shipment, TrackingEvent, ReturnRequest, ReturnItem |
| Settlement | CommissionRule, CommissionSnapshot, Journal, LedgerEntry, Payout, PayoutItem |
| Experience and reliability | Review, SupportTicket, Notification, CmsPage, OutboxEvent, InboxEvent, AuditEvent |

Database constraints must enforce organisation/vendor scope, unique SKU and slug rules, provider
event idempotency, positive quantities and valid stock counters. Persist purchase-time price,
tax, discount, commission and policy snapshots.

### Checkout and stock

A mixed-vendor cart is repriced on the server. Produce one expiring quote and customer order
with separate vendor sub-orders. Each vendor sees only its own order and necessary fulfilment
details.

In one transaction, create orders, immutable snapshots, reservations and outbox events. Lock
inventory in stable order or use bounded conditional-update retries. Reservation expiry,
payment success, failure and COD placement must each consume or release stock at most once.
Late payment after expiry must reacquire stock atomically or enter refund/reconciliation; never
oversell or silently fulfil an unfunded order.

Keep payment, fulfilment and return states independent. Derive customer summaries from child
states so partial cancellation does not incorrectly cancel the whole order.

### Pricing, ledger and payouts

Use one pricing service for cart quotes, checkout and order snapshots. Persist item/vendor
allocation for charges and discounts, the discount funder, commission basis and selected rule.
Support percentage basis points and fixed minor-unit commissions with explicit units. Apply
deterministic integer rounding and make child totals add exactly to the customer total. Reverse
the original allocations for refunded quantities only.

Maintain a balanced double-entry subledger per journal and currency. Distinguish pending and
available vendor earnings, payout holds and amounts paid. Release funds only after the approved
delivery/return hold, collection or reconciliation and dispute checks. Reserve payout entries
atomically. Payout success, failure, reversal and post-payout refund use new ledger entries;
never rewrite history. Initial payouts are manually approved recorded transfers. Financial,
tax, commission and return policies remain explicit business decisions, not invented defaults.

## Providers and background reliability

Keep payments, shipping, messaging, storage, AI and queues behind typed adapter contracts.
Do external calls outside database transactions. Persist operation identifiers, request hashes
and retry state before dispatch; make irreversible outcomes reconcilable.

Verify webhooks against raw request bytes before parsing. Bind provider accounts to the
organisation; persist uniquely keyed inbox events before acknowledging. Handle duplicate and
out-of-order events idempotently. Record outbox events in the same transaction as the business
change, then dispatch asynchronously. Use bounded retries, explicit backoff, timeouts and
dead-letter handling. Reconciliation is required when a provider result is unknown.

Workers handle reservation expiry, payment/COD reconciliation, notifications, shipping updates,
AI drafts, ledger eligibility and report exports. Use durable jobs, not request-time timers or
process memory. Keep worker ownership, shutdown, health and readiness observable.

## Identity and security

| Actor | Scope and restrictions |
| --- | --- |
| Customer | Own profile, addresses, cart, orders, reviews and support |
| Vendor Owner | Own store, approved staff, catalogue, sub-orders and earnings |
| Vendor Staff | Explicit store permissions; no bank/payout access unless granted |
| Admin Staff | Organisation-scoped operations and moderation permissions |
| Organisation Owner | Organisation settings, roles and approved financial controls |
| Operator | Authorized provisioning; no standing unrestricted customer-data super-admin |

Use the approved authentication library, library-managed password hashing and secure HttpOnly
cookies. Require HTTPS, origin/CSRF checks, session expiry/revocation and re-authentication for
sensitive changes. Verify contact details; rate-limit OTP attempts/resends in shared storage;
use short expiry and single use. Never log or expose OTPs. Require server-enforced admin TOTP
and test every alternate login/recovery path against MFA bypass.

Validate inputs; parameterize database access; sanitize CMS content. Restrict and inspect uploads,
prevent remote-image SSRF, keep private KYC records separate from public media, and define
retention/deletion controls. Apply least privilege, shared rate limits and redacted structured
logs. Audit actor, organisation, action, target and request identifier without secrets or
sensitive authentication payloads. Repository authorization is mandatory; row-level security
is only an additional layer after transaction-scoped tenant context is verified.

## Runtime, releases and API standards

Keep development, test, staging and production isolated. Run the web and worker as separate
supervised processes; expose only the web HTTP port. Forward termination signals and stop
claiming jobs before shutdown. Configure database connection limits and worker concurrency for
the target environment.

Use ordered additive migrations and a single coordinated migration runner. Never let every web
replica migrate on startup. Test a locked install, migration, rollback compatibility, backup and
restore on non-production data before release. Confirm the target database, provider accounts,
webhook origins, secret references and recovery process with the release owner. Production
publishing is a distinct, explicitly authorized release step.

Start with persistent compute appropriate for a continuously running worker. Later HTTP scaling
must preserve shared database access, rate limits, job ownership and readiness across replicas.
Introduce caching or a separate search service only for measured requirements. Store uploads
in an object-storage adapter, never on an ephemeral application filesystem. Configure secrets
outside source control and commit names only.

Use `/api/v1` for business APIs, an isolated authentication route namespace and stable webhook
routes. Validate inputs and outputs against shared schemas. Use cursor pagination, allowlisted
sorting, bounded page sizes and explicit errors with a request ID. Sensitive mutations require
idempotency keys scoped by actor, organisation and operation; reject reuse with different
request content. Never trust browser totals, role names, commission amounts or payment success.
Do not publicly cache authenticated or personal data.

`/api/healthz` reports process liveness only. `/api/readyz` verifies database and migration
readiness plus a recent worker heartbeat without exposing secrets. Monitor queue age, failed
jobs, payment mismatches, refund age, stuck shipments and payout discrepancies. Proposed
performance goals (warm internal read p95 below 500 ms and checkout database transaction below
one second, excluding providers) require measurement against agreed traffic fixtures; they are
not production SLAs.

## Search, AI and public experience

Implement normal search and manual product entry first. AI is provider-neutral, budgeted per
organisation, time-bounded and disabled until evaluated. Natural-language search resolves only
allowlisted fields and returns existing visible products through normal permission, stock and
vendor filters; the model must not generate SQL. On failure, fall back to ordinary search.

AI product entry produces an untrusted draft for human review. Do not invent product facts or
allow self-publication. Restrict tools/outbound access, validate output and keep KYC, bank data,
addresses and secrets away from AI providers. Measure retrieval and draft quality before
enabling; recommendations require separate consent and retention design.

Public landing pages should use canonical URLs, product structured data, metadata, sitemap,
robots and social sharing. Private panels must not be indexed; robots rules are not access
control. Content management owns About, Terms, Privacy and Return Policy pages. Reports derive
sales, refunds and earnings from scoped transaction records.

## Module gates and completion reports

Build one reviewable module at a time. Check existing functionality first. A module is complete
only with relevant passing tests, reviewed migrations, updated docs and an acceptance report.
Do not claim a provider integration based only on mock-provider results.

Each report states previous-module assessment, implemented behavior, files changed, schema and
migrations, commands and actual results, provider modes, limitations and remaining dependencies.
Missing credentials, failed checks or unavailable integrations are blockers, not passing results.

Mobile apps, recommendations, loyalty, customer stored-value wallets and subscriptions require
separate implementation milestones. No provisional launch timing overrides an explicit scope
decision.

## Non-secret client configuration

```json
{
  "schemaVersion": 1,
  "clientKey": "euro-infotech",
  "projectCode": "261002",
  "displayName": "Euro Infotech",
  "locale": "en-IN",
  "currency": "INR",
  "timeZone": "Asia/Kolkata",
  "deploymentMode": "dedicated-client",
  "enabledModules": ["organisation-config", "identity"],
  "plannedModules": ["vendors", "catalogue", "inventory", "discovery", "cart",
    "pricing", "orders", "payments", "fulfilment", "returns", "reviews",
    "commission", "payouts", "ai-search", "ai-product-entry", "cms",
    "notifications", "support", "reports"],
  "providers": {
    "payments": "disabled",
    "shipping": "disabled",
    "messaging": "disabled",
    "ai": "disabled",
    "storage": "disabled"
  },
  "payoutMode": "manual-approved",
  "productionReady": false
}
```

Validate the client profile before use. Public configuration exposes only allowlisted fields.
`productionReady` is descriptive metadata and never an authorization mechanism.

## Environment contract and release inputs

Only variable names belong in `.env.example`. Put values in the selected environment's secret
store and validate configuration at startup. Names used by later provider adapters are selected
and documented only after provider approval.

| Variable group | Purpose |
| --- | --- |
| `DATABASE_URL`, `TEST_DATABASE_URL` | Environment-specific PostgreSQL and isolated test databases |
| `APP_ORIGIN`, `CLIENT_CONFIG_KEY`, `PORT` | Origin, client selector and public HTTP port |
| Authentication/encryption secrets | Session and application data protection, with rotation metadata |
| `STORAGE_PROVIDER` | Approved storage adapter |
| `PAYMENT_*`, `SHIPPING_*`, `MESSAGING_*`, `AI_*` | Approved provider settings for the corresponding milestone |

Never invent provider account identifiers, expose secrets through public variables or source
control, reuse a production database in tests, or weaken TLS to hide a connectivity issue.

Before launch, confirm seller/invoice ownership, commission basis/rates, KYC fields and reviewers,
payment/courier accounts, shipping charge ownership, coupon funding, cancellation/return rules,
refund allocation, payout holds, support channels, catalogue size, traffic goals and mobile scope.
Agree recovery targets and retention. Verify encrypted backups with a restore drill and obtain
operational handover of repository, release, migration, provider, roles, runbook and limitations.

## Initial foundation milestone

Implement M01 only when bootstrapping a new workspace. Inspect existing work and preserve it.
Create the pinned TypeScript workspace with a Next.js web/API, separate Node worker, shared
packages and PostgreSQL/Prisma. Verify runtime/database/queue compatibility before pinning.
Implement tenant configuration, additive migrations, a safe repeatable development seed, scoped
authorization primitives, an outbox, idempotency, durable smoke job, heartbeat and readiness.
Expose one web port. Keep customer/vendor/admin panels inaccessible until their identity and
permission gates are implemented. Planned features must be labelled planned.

Required gates: locked install, lint, typecheck, unit/integration tests, clean disposable-schema
migration, repeat seed, web/worker build, HTTP smoke, and worker-restart recovery. Verify domain
isolation, disabled-module enforcement and private-route denial. Never run destructive tests or
synthetic seeds against production.

Stop after the approved module. Do not implement later marketplace features, use live payment or
messaging credentials, send real messages, invent policy values or publish production without
explicit authorization.
