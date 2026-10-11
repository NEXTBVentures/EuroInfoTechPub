import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./client";

const suffix = randomUUID();
const vendorIds: string[] = [];
const applicationIds: string[] = [];
const invitationHashes: string[] = [];
let organizationId = "";
let otherOrganizationId = "";
let membershipId = "";
let userId = "";
let vendorId = "";
let applicationId = "";

beforeAll(async () => {
  if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("Vendor integration fixtures refuse production and published deployments");
  }
  const organization = await prisma.organization.findUniqueOrThrow({ where: { key: "euro-infotech" } });
  const otherOrganization = await prisma.organization.findUniqueOrThrow({ where: { key: "synthetic-isolation-fixture" } });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: "synthetic-m02-customer" } });
  const membership = await prisma.organizationMembership.findUniqueOrThrow({
    where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
  });
  organizationId = organization.id;
  otherOrganizationId = otherOrganization.id;
  membershipId = membership.id;
  userId = user.id;

  const vendor = await prisma.vendor.create({
    data: { organizationId, legalName: `M03 Integration ${suffix}`, storeName: `Vendor ${suffix}` },
  });
  vendorId = vendor.id;
  vendorIds.push(vendor.id);
  const application = await prisma.vendorApplication.create({
    data: { organizationId, vendorId, applicantMembershipId: membershipId },
  });
  applicationId = application.id;
  applicationIds.push(application.id);
});

afterAll(async () => {
  if (invitationHashes.length) {
    await prisma.vendorStaffInvitation.deleteMany({ where: { tokenHash: { in: invitationHashes } } });
  }
  if (applicationIds.length) {
    await prisma.vendorDecision.deleteMany({ where: { applicationId: { in: applicationIds } } });
    await prisma.vendorSubmission.deleteMany({ where: { applicationId: { in: applicationIds } } });
    await prisma.vendorDocument.deleteMany({ where: { applicationId: { in: applicationIds } } });
    await prisma.vendorApplication.deleteMany({ where: { id: { in: applicationIds } } });
  }
  if (vendorIds.length) await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  await prisma.$disconnect();
});

describe("M03 vendor persistence", () => {
  it("scopes an application to its organisation and rejects cross-tenant relationships", async () => {
    expect(await prisma.vendorApplication.findFirst({
      where: { id: applicationId, organizationId: otherOrganizationId },
    })).toBeNull();

    await expect(prisma.vendorApplication.create({
      data: {
        organizationId: otherOrganizationId,
        vendorId,
        applicantMembershipId: membershipId,
      },
    })).rejects.toThrow();
  });

  it("allows only one active onboarding application per applicant and organisation", async () => {
    const duplicateVendor = await prisma.vendor.create({
      data: { organizationId, legalName: `Duplicate ${suffix}`, storeName: `Duplicate ${suffix}` },
    });
    vendorIds.push(duplicateVendor.id);
    await expect(prisma.vendorApplication.create({
      data: { organizationId, vendorId: duplicateVendor.id, applicantMembershipId: membershipId },
    })).rejects.toThrow();
  });

  it("stores invitation digests rather than the one-time bearer token", async () => {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    invitationHashes.push(tokenHash);
    const invitation = await prisma.vendorStaffInvitation.create({
      data: {
        organizationId,
        vendorId,
        invitedByMembershipId: membershipId,
        email: "verified-staff@example.invalid",
        tokenHash,
        permissionKeys: ["vendor.profile.manage"],
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      select: { tokenHash: true, permissionKeys: true },
    });
    expect(invitation.tokenHash).not.toBe(token);
    expect(invitation.tokenHash).toBe(tokenHash);
    expect(invitation.permissionKeys).toEqual(["vendor.profile.manage"]);
  });

  it("rejects decisions without a meaningful internal reason", async () => {
    await expect(prisma.vendorDecision.create({
      data: {
        organizationId,
        vendorId,
        applicationId,
        actorUserId: userId,
        fromStatus: "DRAFT",
        toStatus: "SUBMITTED",
        internalReason: "",
      },
    })).rejects.toThrow();
  });
});
