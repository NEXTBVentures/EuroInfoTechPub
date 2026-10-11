CREATE TYPE "VendorStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REJECTED');
CREATE TYPE "VendorApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUIRED', 'APPROVED', 'REJECTED', 'SUSPENDED');
CREATE TYPE "VendorBankVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

CREATE TABLE "Vendor" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "status" "VendorStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "legalName" TEXT, "storeName" TEXT, "entityType" TEXT,
  "registeredAddress" JSONB, "operationalAddress" JSONB,
  "contactEmail" TEXT, "contactPhone" TEXT,
  "taxIdentifiers" JSONB, "businessIdentifiers" JSONB,
  "contactPersonName" TEXT, "description" TEXT,
  "supportEmail" TEXT, "supportPhone" TEXT, "shippingOrigins" JSONB,
  "logoReference" UUID, "bannerReference" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Vendor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Vendor_id_organizationId_key" ON "Vendor"("id", "organizationId");
CREATE INDEX "Vendor_organizationId_status_updatedAt_idx" ON "Vendor"("organizationId", "status", "updatedAt");

CREATE TABLE "VendorApplication" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "vendorId" UUID NOT NULL,
  "applicantMembershipId" UUID NOT NULL,
  "status" "VendorApplicationStatus" NOT NULL DEFAULT 'DRAFT',
  "submittedAt" TIMESTAMPTZ(6), "reviewedAt" TIMESTAMPTZ(6),
  "approvedAt" TIMESTAMPTZ(6), "rejectedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "VendorApplication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VendorApplication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorApplication_vendorId_organizationId_fkey" FOREIGN KEY ("vendorId", "organizationId") REFERENCES "Vendor"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorApplication_applicantMembershipId_organizationId_fkey" FOREIGN KEY ("applicantMembershipId", "organizationId") REFERENCES "OrganizationMembership"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VendorApplication_id_organizationId_key" ON "VendorApplication"("id", "organizationId");
CREATE UNIQUE INDEX "VendorApplication_vendorId_organizationId_key" ON "VendorApplication"("vendorId", "organizationId");
CREATE INDEX "VendorApplication_organizationId_status_createdAt_idx" ON "VendorApplication"("organizationId", "status", "createdAt");
CREATE INDEX "VendorApplication_organizationId_applicantMembershipId_stat_idx" ON "VendorApplication"("organizationId", "applicantMembershipId", "status");
CREATE UNIQUE INDEX "VendorApplication_one_active_per_applicant" ON "VendorApplication"("organizationId", "applicantMembershipId") WHERE "status" IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUIRED');

CREATE TABLE "VendorSubmission" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "applicationId" UUID NOT NULL,
  "revision" INTEGER NOT NULL, "profileSnapshot" JSONB NOT NULL,
  "documentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "submittedByUserId" TEXT NOT NULL,
  "submittedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VendorSubmission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VendorSubmission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorSubmission_applicationId_organizationId_fkey" FOREIGN KEY ("applicationId", "organizationId") REFERENCES "VendorApplication"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VendorSubmission_applicationId_revision_key" ON "VendorSubmission"("applicationId", "revision");
CREATE INDEX "VendorSubmission_organizationId_submittedAt_idx" ON "VendorSubmission"("organizationId", "submittedAt");

CREATE TABLE "VendorDocument" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "vendorId" UUID NOT NULL, "applicationId" UUID NOT NULL,
  "category" TEXT NOT NULL, "storageKey" TEXT NOT NULL, "originalFilename" TEXT NOT NULL,
  "mediaType" TEXT NOT NULL, "sizeBytes" INTEGER NOT NULL, "sha256" TEXT NOT NULL,
  "uploadedByUserId" TEXT NOT NULL, "supersedesId" UUID, "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "uploadedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "replacedAt" TIMESTAMPTZ(6),
  CONSTRAINT "VendorDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VendorDocument_id_organizationId_vendorId_key" UNIQUE ("id", "organizationId", "vendorId"),
  CONSTRAINT "VendorDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorDocument_vendorId_organizationId_fkey" FOREIGN KEY ("vendorId", "organizationId") REFERENCES "Vendor"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorDocument_applicationId_organizationId_fkey" FOREIGN KEY ("applicationId", "organizationId") REFERENCES "VendorApplication"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorDocument_supersedesId_organizationId_vendorId_fkey" FOREIGN KEY ("supersedesId", "organizationId", "vendorId") REFERENCES "VendorDocument"("id", "organizationId", "vendorId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorDocument_sizeBytes_check" CHECK ("sizeBytes" > 0)
);
CREATE UNIQUE INDEX "VendorDocument_storageKey_key" ON "VendorDocument"("storageKey");
CREATE INDEX "VendorDocument_organizationId_vendorId_active_category_idx" ON "VendorDocument"("organizationId", "vendorId", "active", "category");
CREATE INDEX "VendorDocument_applicationId_uploadedAt_idx" ON "VendorDocument"("applicationId", "uploadedAt");

CREATE TABLE "VendorDecision" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "vendorId" UUID NOT NULL, "applicationId" UUID NOT NULL,
  "actorUserId" TEXT NOT NULL, "fromStatus" "VendorApplicationStatus" NOT NULL,
  "toStatus" "VendorApplicationStatus" NOT NULL, "internalReason" TEXT NOT NULL,
  "vendorMessage" TEXT, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VendorDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VendorDecision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorDecision_vendorId_organizationId_fkey" FOREIGN KEY ("vendorId", "organizationId") REFERENCES "Vendor"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorDecision_applicationId_organizationId_fkey" FOREIGN KEY ("applicationId", "organizationId") REFERENCES "VendorApplication"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorDecision_reason_check" CHECK (length(btrim("internalReason")) >= 5)
);
CREATE INDEX "VendorDecision_organizationId_vendorId_createdAt_idx" ON "VendorDecision"("organizationId", "vendorId", "createdAt");
CREATE INDEX "VendorDecision_applicationId_createdAt_idx" ON "VendorDecision"("applicationId", "createdAt");

CREATE TABLE "VendorStaffInvitation" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "vendorId" UUID NOT NULL,
  "invitedByMembershipId" UUID NOT NULL, "acceptedMembershipId" UUID,
  "email" TEXT, "phone" TEXT, "tokenHash" TEXT NOT NULL,
  "permissionKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "expiresAt" TIMESTAMPTZ(6) NOT NULL, "acceptedAt" TIMESTAMPTZ(6), "revokedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VendorStaffInvitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VendorStaffInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorStaffInvitation_vendorId_organizationId_fkey" FOREIGN KEY ("vendorId", "organizationId") REFERENCES "Vendor"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorStaffInvitation_invitedByMembershipId_organizationId_fkey" FOREIGN KEY ("invitedByMembershipId", "organizationId") REFERENCES "OrganizationMembership"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorStaffInvitation_acceptedMembershipId_organizationId_fkey" FOREIGN KEY ("acceptedMembershipId", "organizationId") REFERENCES "OrganizationMembership"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorStaffInvitation_contact_check" CHECK (("email" IS NOT NULL) OR ("phone" IS NOT NULL))
);
CREATE UNIQUE INDEX "VendorStaffInvitation_tokenHash_key" ON "VendorStaffInvitation"("tokenHash");
CREATE INDEX "VendorStaffInvitation_organizationId_vendorId_createdAt_idx" ON "VendorStaffInvitation"("organizationId", "vendorId", "createdAt");
CREATE INDEX "VendorStaffInvitation_expiresAt_acceptedAt_revokedAt_idx" ON "VendorStaffInvitation"("expiresAt", "acceptedAt", "revokedAt");

CREATE TABLE "VendorStaffPermission" (
  "organizationId" UUID NOT NULL, "vendorId" UUID NOT NULL, "membershipId" UUID NOT NULL,
  "permissionKey" TEXT NOT NULL, "grantedByMembershipId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VendorStaffPermission_pkey" PRIMARY KEY ("organizationId", "vendorId", "membershipId", "permissionKey"),
  CONSTRAINT "VendorStaffPermission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorStaffPermission_vendorId_organizationId_fkey" FOREIGN KEY ("vendorId", "organizationId") REFERENCES "Vendor"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VendorStaffPermission_membershipId_organizationId_fkey" FOREIGN KEY ("membershipId", "organizationId") REFERENCES "OrganizationMembership"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VendorStaffPermission_grantedByMembershipId_organizationId_fkey" FOREIGN KEY ("grantedByMembershipId", "organizationId") REFERENCES "OrganizationMembership"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "VendorStaffPermission_organizationId_membershipId_idx" ON "VendorStaffPermission"("organizationId", "membershipId");

CREATE TABLE "VendorBankProfile" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "vendorId" UUID NOT NULL,
  "ciphertext" TEXT NOT NULL, "keyVersion" TEXT NOT NULL, "lastFour" TEXT NOT NULL,
  "verificationStatus" "VendorBankVerificationStatus" NOT NULL DEFAULT 'PENDING',
  "supportingDocumentId" UUID, "verifiedAt" TIMESTAMPTZ(6), "verifiedByUserId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "VendorBankProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VendorBankProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorBankProfile_vendorId_organizationId_fkey" FOREIGN KEY ("vendorId", "organizationId") REFERENCES "Vendor"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorBankProfile_lastFour_check" CHECK ("lastFour" ~ '^[0-9]{4}$')
);
CREATE UNIQUE INDEX "VendorBankProfile_vendorId_organizationId_key" ON "VendorBankProfile"("vendorId", "organizationId");
CREATE INDEX "VendorBankProfile_organizationId_verificationStatus_idx" ON "VendorBankProfile"("organizationId", "verificationStatus");

CREATE TABLE "VendorAuditEvent" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "vendorId" UUID NOT NULL,
  "actorUserId" TEXT, "action" TEXT NOT NULL, "targetId" TEXT, "requestId" TEXT,
  "metadata" JSONB, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VendorAuditEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VendorAuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VendorAuditEvent_vendorId_organizationId_fkey" FOREIGN KEY ("vendorId", "organizationId") REFERENCES "Vendor"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "VendorAuditEvent_organizationId_vendorId_createdAt_idx" ON "VendorAuditEvent"("organizationId", "vendorId", "createdAt");
CREATE INDEX "VendorAuditEvent_actorUserId_createdAt_idx" ON "VendorAuditEvent"("actorUserId", "createdAt");
