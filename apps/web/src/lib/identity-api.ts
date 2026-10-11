import "server-only";
import { verifyPassword } from "better-auth/crypto";
import { NextResponse } from "next/server";
import { prisma } from "@workspace/database";
import { getIdentityContext, type IdentityContext } from "./identity-context";
import { recordAuthAudit } from "./auth-audit";
import { allowSecurityAttempt } from "./security-rate-limit";

export async function requireIdentity(request: Request): Promise<
  | { identity: IdentityContext; response?: never }
  | { identity?: never; response: NextResponse }
> {
  if (request.method !== "GET" && !stateChangingOriginIsValid(request)) {
    return { response: NextResponse.json({ error: "invalid_request_origin" }, { status: 403 }) };
  }
  const identity = await getIdentityContext(request.headers);
  if (!identity) {
    return {
      response: NextResponse.json({ error: "authentication_required" }, { status: 401 }),
    };
  }
  return { identity };
}

export function stateChangingOriginIsValid(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return ["http:", "https:"].includes(parsed.protocol) &&
      parsed.host.toLowerCase() === host.trim().toLowerCase();
  } catch {
    return false;
  }
}

export async function requireFreshSecondFactor(
  identity: IdentityContext,
): Promise<NextResponse | null> {
  if (identity.needsAdminTwoFactor && !identity.hasVerifiedTotp) {
    return NextResponse.json({ error: "enrollment_required" }, { status: 403 });
  }
  if ((identity.needsAdminTwoFactor || identity.user.twoFactorEnabled) && !identity.mfaFresh) {
    return NextResponse.json({ error: "two_factor_challenge_required" }, { status: 428 });
  }
  return null;
}

export async function reauthenticatePassword(
  userId: string,
  password: string,
): Promise<boolean> {
  const account = await prisma.account.findFirst({
    where: { userId, providerId: "credential" },
    select: { password: true },
  });
  if (!account?.password) return false;
  return verifyPassword({ hash: account.password, password });
}

export async function markCurrentSessionMfa(
  identity: IdentityContext,
  method: "totp" | "recovery-code",
): Promise<void> {
  await prisma.session.update({
    where: { id: identity.session.id },
    data: { mfaVerifiedAt: new Date(), mfaMethod: method },
  });
}

export async function enforceRecentAuthentication(
  request: Request,
  identity: IdentityContext,
  password: string,
  code?: string,
): Promise<NextResponse | null> {
  const key = `m02:reauth:${identity.tenant.id}:${identity.user.id}`;
  if (!(await allowSecurityAttempt(key, 5, 300))) {
    return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  }
  if (!(await reauthenticatePassword(identity.user.id, password))) {
    await recordAuthAudit({
      eventType: "AUTH_LOGIN_FAILURE",
      organizationId: identity.tenant.id,
      actorUserId: identity.user.id,
      requestId: request.headers.get("x-request-id"),
    });
    return NextResponse.json({ error: "reauthentication_failed" }, { status: 401 });
  }
  if (identity.user.twoFactorEnabled) {
    if (!code) return NextResponse.json({ error: "two_factor_code_required" }, { status: 400 });
    const response = await verifyCurrentTotp(request, identity, code);
    if (response) return response;
  }
  return null;
}

async function verifyCurrentTotp(
  request: Request,
  identity: IdentityContext,
  code: string,
): Promise<NextResponse | null> {
  const { decryptTotpSecret, verifyTotp } = await import("./totp");
  const credential = await prisma.adminTotpCredential.findUnique({
    where: { userId: identity.user.id },
  });
  if (!credential?.verifiedAt) {
    return NextResponse.json({ error: "two_factor_enrollment_required" }, { status: 403 });
  }
  let step: bigint | null = null;
  try {
    step = verifyTotp(
      decryptTotpSecret(credential.secretCiphertext),
      code,
      Date.now(),
      credential.lastAcceptedStep,
    );
  } catch {
    step = null;
  }
  if (step === null) {
    await recordAuthAudit({
      eventType: "TOTP_VERIFICATION_FAILURE",
      organizationId: identity.tenant.id,
      actorUserId: identity.user.id,
      requestId: request.headers.get("x-request-id"),
    });
    return NextResponse.json({ error: "invalid_two_factor_code" }, { status: 401 });
  }
  const accepted = await prisma.adminTotpCredential.updateMany({
    where: { id: credential.id, lastAcceptedStep: credential.lastAcceptedStep },
    data: { lastAcceptedStep: step },
  });
  if (accepted.count !== 1) {
    return NextResponse.json({ error: "invalid_two_factor_code" }, { status: 401 });
  }
  await markCurrentSessionMfa(identity, "totp");
  await recordAuthAudit({
    eventType: "TOTP_VERIFICATION_SUCCESS",
    organizationId: identity.tenant.id,
    actorUserId: identity.user.id,
    requestId: request.headers.get("x-request-id"),
  });
  return null;
}
