# M02 identity and access

## Approved stack and scope

Better Auth **1.7.7**, official Prisma adapter, Next.js **16.4.0** App Router,
Prisma **7.10.0**, PostgreSQL, TypeScript, separate existing Node worker.
Official Better Auth core and adapter packages resolve to 1.7.7 in `pnpm-lock.yaml`;
the officially declared utility dependency is 0.4.2. The user-approved standard
`pnpm --filter @workspace/web add --save-exact better-auth@1.7.7` succeeded;
blocked 1.7.5 was not bypassed. No mirrors, archives, vendored code or auth-library substitution.

Only organisation configuration and identity are implemented/enabled. Nineteen modules remain
planned. Production readiness remains false. No NEXTB Operator role is provisioned:
there is no operational need for standing customer-data access in this dedicated-client module.

## Authentication and delivery

`/register`, `/login`, `/phone-login`, `/verify-email`, `/forgot-password`,
`/reset-password`, `/security/totp`, `/account/security`, `/access-denied`.
Email login requires verified email. Passwords have a minimum of 12 and maximum of 128 characters
and are hashed by the official library. Reset tokens and email verification are single-use/expiring.
Password resets invalidate existing sessions.

Phone login uses only OTP, not a phone/password fallback. Customers link a phone from account
security only after password re-authentication and TOTP when enrolled. The linked number is
verified by its one-time code before any login can succeed. New unlinked numbers cannot register
accounts through the phone endpoint. LOGIN and LINK challenges have separate tenant-bound hashes;
LINK also binds the current user. There are no production phone providers yet.

Email/SMS delivery uses the neutral in-process test adapter in automated tests only. Capture
requires `AUTH_TEST_ADAPTERS=true` and non-production NODE_ENV. It is never persisted,
logged, or available through HTTP. Otherwise delivery-dependent endpoints fail safely with 503;
recovery requests fail uniformly regardless of whether the address exists.
Tests exercise actual verification/reset links and phone codes via this adapter.
Operator-provided live integrations and credentials are a separate, unapproved setup step.

## Isolation and authorization

Host → existing Domain → Organisation; development fallback requires explicit opt-in.
Identity must be enabled and implemented for that organisation. Sessions establish a user,
not a tenant. Every protected request resolves an active same-organisation membership.
Never accept organisation identifiers from request bodies as authorization.

Customer, Vendor Owner, Vendor Staff, Admin Staff and Organisation Owner roles are scoped
per organisation, as are the 15 permission keys in `packages/core/src/identity.ts`.
Composite foreign keys prevent cross-organisation grants.
Role names alone are insufficient: server guards require relevant fine-grained permissions.
Future permission names do not implement future business workflows.

`/account`: customer membership and customer.profile.manage.
`/vendor`: approved, vendor-scoped assignment and vendor.profile.manage.
`/admin`: active administrator membership, applicable admin/organisation permission,
verified TOTP credential and a session MFA check within 12 hours.
`/api/v1/identity/vendor/[vendorId]` additionally checks the exact approved vendor assignment.
Vendor approval, private onboarding evidence and vendor-scoped staff grants are implemented in
[M03 vendor onboarding and management](vendors.md). A role assignment alone does not bypass the
vendor application status or organisation-scoped permission checks.

Owner role changes require admin.roles.manage, current password and TOTP.
Privileged grants require the recipient to have TOTP already enrolled. Last owner removal
is rejected. Role changes clear the recipient's session MFA state and emit both role and
permission change audit events. Suspended memberships are never silently reactivated.
Seed users are inert and have no fixed credentials.

## Security and session behavior

Cookies are HttpOnly, SameSite=Lax and Secure in production; no tokens are kept in localStorage.
Sessions expire after 30 days, refresh daily, and can be revoked individually or all together.
All sensitive actions re-authenticate with the password and TOTP when enrolled.
The APIs expose session IDs/times/user-agent, never raw tokens.
Current/all logout revokes database state, clears the cookie and performs a full navigation.
Server checks are the authorization boundary. Protected pages revalidate browser-history restores.
The proxy adds no-store cache headers; middleware alone is not used as an authorization boundary.
Mutations reject missing/mismatched Origin, external redirect paths are rejected, and private
API responses use no-store.

Administrator TOTP uses AES-256-GCM encryption of its secret and RFC 6238 codes with a
30-second period, ±1 time step, atomic replay prevention and 10-minute pending enrolment.
The setup secret is returned only while pending, never after verification.
Recovery codes are shown once; only user-bound, purpose-keyed HMAC hashes are stored.
Recovery redemption is atomic and one-time. They complete a session challenge but do not
authorize password/TOTP-sensitive changes.
TOTP removal is prohibited while any active administrator membership remains.
No built-in Better Auth two-factor plugin is used because its recovery storage modes do
not satisfy the required hash-only storage; Better Auth remains the authentication library.

Database-backed rate limits persist across processes. Atomic extra admission guards prevent
concurrent login requests exceeding five attempts per trusted source/tenant/endpoint/minute.
Better Auth also has database-backed route limits.
Sensitive re-authentication: five per five minutes; security actions: five per action/five minutes.
OTP: five-minute expiry, three guesses, three send attempts/15 minutes per tenant/phone/purpose,
and a 60-second resend cooldown while a challenge is outstanding. Consumed challenges are deleted.
Delivery-disabled states never mint an OTP.

Audit rows contain an enumerated event, timestamp, organisation and opaque actor/target/request
identifiers only. No passwords, tokens, email/phone values, TOTP secrets, OTPs or recovery codes
are accepted as audit metadata. Authentication failures, verification, password changes, session
revocation, role/permission changes and MFA events are recorded.

## API surface

| Route | Behavior |
|---|---|
| `/api/auth/[...all]` | Wrapped official auth handler; allowlisted POST paths, tenant/Origin validation, shared input schemas, audit and limits |
| `GET /api/v1/identity/session` | Current self, tenant, roles, permissions, MFA gate; no token |
| `POST /api/v1/identity/phone/send` | E.164 phone + LOGIN or LINK purpose; LINK requires recent auth |
| `GET /api/v1/identity/security` | Current self's active sessions and MFA/recovery summary |
| `POST /api/v1/identity/security` | Discriminated enrol/verify/recover/remove/revokeOne/revokeAll actions |
| `GET/POST/DELETE /api/v1/identity/roles` | Scoped membership listing and protected role grant/revoke |
| `GET /api/v1/identity/vendor/[vendorId]` | Approved identity scope only; no vendor business data |

Role POST/DELETE body: userId, roleKey, optional vendorId, password, code.
Security sensitive actions similarly include password and code where TOTP is enabled;
verification uses code, recovery uses recoveryCode, single-session revoke uses sessionId.
Schemas are shared in `packages/contracts/src/identity.ts`.
There are no live-provider, operator impersonation, marketplace or public test-inbox endpoints.
