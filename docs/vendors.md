# M03 vendor onboarding and management

M03 covers seller applications, organisation-scoped review, private KYC files, approved
store-profile edits, scoped staff access and bank-profile verification. Catalogue,
inventory, pricing, orders, checkout, payouts and production publishing are not part of M03.

## Application and review

- Customers can save a draft, attach private evidence and submit an application. Submission
  requires the verified account contact and configured application/document requirements.
- Submitted applications use the explicit review lifecycle. Admin decisions require an
  internal reason; a separate optional vendor message is the only decision text shown to
  applicants.
- Application snapshots and decisions are retained as review history. Store-facing profile
  edits are available only to approved, active vendors with the scoped permission.
- Admin lists, details and decisions are organisation-scoped. Approval/suspension and bank
  verification are separate permissions; fresh administrator second-factor checks apply.

## Permission matrix

| Role | Vendor applications | Staff and bank access | Review and decisions |
| --- | --- | --- | --- |
| Customer | Create and upload evidence for their application | None by default | None |
| Vendor owner | View onboarding and manage approved vendor profile/staff; bank access is scoped to the assigned vendor | Bank profile access for that vendor | None |
| Vendor staff | Only permissions explicitly granted for its vendor assignment | Bank access is not included by default; it requires a separate vendor-scoped grant | None |
| Administrator staff | View and review organisation applications | No bank verification or bank details by default | Cannot approve or suspend by default |
| Organisation owner | View and configure onboarding policy | Organisation-scoped vendor administration | May approve, suspend/reactivate and verify bank profiles |

## Private files and bank data

- Uploads enforce configured content-type, size and file-signature checks and use generated
  opaque storage identifiers. Reads authorize the current applicant/vendor or an authorized
  organisation reviewer, and responses are not cacheable.
- The local file adapter is development/test-only and refuses production or published
  deployments. Production uploads remain unavailable until an approved private object-storage
  provider is selected and configured (BD-013).
- Bank values are AES-256-GCM encrypted before persistence. API responses expose only a
  masked account identifier and verification state; administrative review never decrypts or
  returns the full number. Missing/invalid encryption keys fail closed. Key rotation must
  retain old version keys until old ciphertext has been re-encrypted.

## Staff, notifications and current limits

- Staff invitations contain a one-time random token; only its hash is stored. Acceptance
  requires a signed-in account with a verified contact matching the invitation. Granted
  permissions are vendor-scoped and never grant administrator or payout privileges.
- Invitations currently expire after 72 hours. This is a technical default pending BD-015.
- Invitation links are returned for the vendor owner to share manually. Email/SMS delivery
  is not configured. Vendor outbox records contain identifiers and status only; the worker
  marks them as blocked by the unconfigured provider and does not mark them delivered.
- KYC requirements, reviewer governance and retention/deletion periods remain TBC under
  BD-010. No production document provider has been selected under BD-013.

See [environment configuration](environment.md) and [M03 verification evidence](verification-m03.md).
