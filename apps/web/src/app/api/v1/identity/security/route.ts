import { NextResponse } from "next/server";
import { prisma } from "@workspace/database";
import { identitySecurityActionSchema } from "@workspace/contracts";
import { auth } from "../../../../../lib/auth";
import { requireIdentity, enforceRecentAuthentication, requireFreshSecondFactor } from "../../../../../lib/identity-api";
import { recordAuthAudit } from "../../../../../lib/auth-audit";
import { allowSecurityAttempt } from "../../../../../lib/security-rate-limit";
import {
  generateTotpSecret, encryptTotpSecret, decryptTotpSecret, makeTotpUri,
  verifyTotp, generateRecoveryCodes, hashRecoveryCode,
} from "../../../../../lib/totp";

export const dynamic = "force-dynamic";

function result(body: object, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  const guard = await requireIdentity(request);
  if (guard.response) return guard.response;
  const identity = guard.identity;
  const denied = await requireFreshSecondFactor(identity);
  if (denied) return denied;
  const sessions = await prisma.session.findMany({
    where: { userId: identity.user.id, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, expiresAt: true, userAgent: true },
  });
  return result({
    user: { name: identity.user.name, email: identity.user.email, twoFactorEnabled: identity.user.twoFactorEnabled },
    sessions: sessions.map((session) => ({ ...session, current: session.id === identity.session.id })),
    recoveryCodesRemaining: await prisma.authRecoveryCode.count({ where: { userId: identity.user.id } }),
    adminTwoFactorRequired: identity.needsAdminTwoFactor,
  });
}

export async function POST(request: Request): Promise<Response> {
  const guard = await requireIdentity(request);
  if (guard.response) return guard.response;
  const identity = guard.identity;
  const parsed = identitySecurityActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return result({ error: "invalid_request" }, 400);
  const input = parsed.data;
  if (!await allowSecurityAttempt(`m02:security:${identity.user.id}:${input.action}`, 5, 300)) {
    return result({ error: "too_many_attempts" }, 429);
  }
  const audit = {
    organizationId: identity.tenant.id,
    actorUserId: identity.user.id,
    requestId: null,
  };
  try {
    if (input.action === "enrol") {
      if (identity.hasVerifiedTotp) return result({ error: "two_factor_already_enrolled" }, 409);
      const denied = await enforceRecentAuthentication(request, identity, input.password);
      if (denied) return denied;
      const secret = generateTotpSecret();
      const data = { secretCiphertext: encryptTotpSecret(secret), setupExpiresAt: new Date(Date.now() + 600_000) };
      const enrolled = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${identity.user.id} FOR UPDATE`;
        const current = await tx.adminTotpCredential.findUnique({ where: { userId: identity.user.id } });
        if (current?.verifiedAt) return false;
        await tx.adminTotpCredential.upsert({
          where: { userId: identity.user.id },
          create: { userId: identity.user.id, ...data },
          update: { ...data, verifiedAt: null, lastAcceptedStep: null },
        });
        return true;
      });
      if (!enrolled) return result({ error: "two_factor_already_enrolled" }, 409);
      await recordAuthAudit({ ...audit, eventType: "TOTP_ENROLMENT_STARTED" });
      return result({ otpauthUrl: makeTotpUri(identity.user.email, secret), secret });
    }

    if (input.action === "verify") {
      const credential = await prisma.adminTotpCredential.findUnique({ where: { userId: identity.user.id } });
      if (!credential || (!credential.verifiedAt && credential.setupExpiresAt.getTime() <= Date.now())) {
        return result({ error: "two_factor_enrollment_required" }, 400);
      }
      const step = verifyTotp(decryptTotpSecret(credential.secretCiphertext), input.code, Date.now(), credential.lastAcceptedStep);
      if (step === null) {
        await recordAuthAudit({ ...audit, eventType: "TOTP_VERIFICATION_FAILURE" });
        return result({ error: "invalid_two_factor_code" }, 401);
      }
      const recoveryCodes = credential.verifiedAt ? undefined : generateRecoveryCodes();
      const accepted = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${identity.user.id} FOR UPDATE`;
        const updated = await tx.adminTotpCredential.updateMany({
          where: { id: credential.id, lastAcceptedStep: credential.lastAcceptedStep, secretCiphertext: credential.secretCiphertext },
          data: { lastAcceptedStep: step, verifiedAt: credential.verifiedAt ?? new Date() },
        });
        if (!updated.count) return false;
        if (recoveryCodes) {
          await tx.user.update({ where: { id: identity.user.id }, data: { twoFactorEnabled: true } });
          await tx.authRecoveryCode.deleteMany({ where: { userId: identity.user.id } });
          await tx.authRecoveryCode.createMany({ data: recoveryCodes.map((code) => ({
            userId: identity.user.id, codeHash: hashRecoveryCode(identity.user.id, code),
          })) });
        }
        await tx.session.update({ where: { id: identity.session.id }, data: { mfaVerifiedAt: new Date(), mfaMethod: "totp" } });
        await tx.authAuditEvent.create({ data: { ...audit, eventType: recoveryCodes ? "TOTP_ENROLMENT_COMPLETED" : "TOTP_VERIFICATION_SUCCESS" } });
        return true;
      });
      if (!accepted) return result({ error: "invalid_two_factor_code" }, 401);
      return result({ success: true, ...(recoveryCodes ? { recoveryCodes } : {}) });
    }

    if (input.action === "recover") {
      if (!identity.hasVerifiedTotp) return result({ error: "two_factor_enrollment_required" }, 400);
      const accepted = await prisma.$transaction(async (tx) => {
        const consumed = await tx.authRecoveryCode.deleteMany({
          where: { userId: identity.user.id, codeHash: hashRecoveryCode(identity.user.id, input.recoveryCode) },
        });
        if (consumed.count !== 1) return false;
        await tx.session.update({ where: { id: identity.session.id }, data: { mfaVerifiedAt: new Date(), mfaMethod: "recovery-code" } });
        await tx.authAuditEvent.create({ data: { ...audit, eventType: "TOTP_RECOVERY_CODE_USED" } });
        return true;
      });
      if (!accepted) {
        await recordAuthAudit({ ...audit, eventType: "TOTP_VERIFICATION_FAILURE" });
        return result({ error: "invalid_recovery_code" }, 401);
      }
      return result({ success: true });
    }

    const denied = await enforceRecentAuthentication(request, identity, input.password, input.code);
    if (denied) return denied;

    if (input.action === "remove") {
      const removed = await prisma.$transaction(async (tx) => {
        // Serialize TOTP removal with privileged role grants to this identity.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${identity.user.id} FOR UPDATE`;
        const adminRoles = await tx.roleAssignment.count({
          where: {
            roleKey: { in: ["ADMIN_STAFF", "ORGANISATION_OWNER"] },
            membership: { userId: identity.user.id, status: "ACTIVE" },
          },
        });
        if (adminRoles) return false;
        await tx.authRecoveryCode.deleteMany({ where: { userId: identity.user.id } });
        await tx.adminTotpCredential.deleteMany({ where: { userId: identity.user.id } });
        await tx.user.update({ where: { id: identity.user.id }, data: { twoFactorEnabled: false } });
        await tx.session.updateMany({ where: { userId: identity.user.id }, data: { mfaVerifiedAt: null, mfaMethod: null } });
        await tx.authAuditEvent.create({ data: { ...audit, eventType: "TOTP_REMOVED" } });
        return true;
      });
      if (!removed) return result({ error: "two_factor_required_for_admin_roles" }, 409);
      return result({ success: true });
    }

    const current = input.action === "revokeAll" || input.sessionId === identity.session.id;
    await prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({
        where: { userId: identity.user.id, ...(input.action === "revokeOne" ? { id: input.sessionId } : {}) },
      });
      await tx.authAuditEvent.create({ data: { ...audit, eventType: "SESSION_REVOKED" } });
    });
    if (current) {
      const signedOut = await auth.api.signOut({ headers: request.headers, asResponse: true });
      const response = result({ success: true, signedOut: true });
      for (const cookie of signedOut.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
      return response;
    }
    return result({ success: true });
  } catch {
    return result({ error: "security_action_unavailable" }, 503);
  }
}
