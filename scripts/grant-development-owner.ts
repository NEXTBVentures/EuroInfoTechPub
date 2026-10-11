import { prisma } from "../packages/database/src/client";
import { randomUUID } from "node:crypto";

if (process.env.SEED_ENV !== "development" || process.env.NODE_ENV === "production" ||
  process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("Owner provisioning script is development-only");
}
const [email, organizationKey = process.env.CLIENT_CONFIG_KEY ?? "euro-infotech"] = process.argv.slice(2);
if (!email) throw new Error("Usage: SEED_ENV=development pnpm identity:grant-owner <registered-email> [organization-key]");
try {
  await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUniqueOrThrow({ where: { key: organizationKey } });
    const user = await tx.user.findUniqueOrThrow({ where: { email: email.toLowerCase() }, include: { totpCredential: true } });
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
    if (!user.emailVerified || !user.twoFactorEnabled || !user.totpCredential?.verifiedAt) {
      throw new Error("Verified email and enrolled TOTP are required before owner provisioning");
    }
    const member = await tx.organizationMembership.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
    });
    if (member.status !== "ACTIVE") throw new Error("An active membership is required");
    if (!await tx.roleAssignment.findFirst({ where: { membershipId: member.id, roleKey: "ORGANISATION_OWNER" } })) {
      await tx.roleAssignment.create({ data: { organizationId: organization.id, membershipId: member.id, roleKey: "ORGANISATION_OWNER" } });
      await tx.session.updateMany({ where: { userId: user.id }, data: { mfaVerifiedAt: null, mfaMethod: null } });
      for (const eventType of ["ROLE_CHANGED", "PERMISSION_CHANGED"] as const) {
        await tx.authAuditEvent.create({ data: { eventType, organizationId: organization.id, targetUserId: user.id, requestId: randomUUID() } });
      }
    }
  });
  console.log("Development owner provisioned; a fresh TOTP challenge is required. No credentials were created or printed.");
} finally {
  await prisma.$disconnect();
}
